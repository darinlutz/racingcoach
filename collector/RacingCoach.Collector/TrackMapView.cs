using System.Globalization;
using System.Windows;
using System.Windows.Media;

namespace RacingCoach.Collector;

/// <summary>
/// The Live Racing tab's map: the track's outline (LiveRacing.Map) fitted to the control, its focus areas in red
/// (the one the car is in brighter), the start/finish line, and the car as a dot at its live LapDistPct. The window
/// sets Map and CarPct every frame while the tab is showing; it redraws only when they change.
/// </summary>
internal sealed class TrackMapView : FrameworkElement
{
    private const double Inset = 28;
    private static readonly Pen Casing = FrozenPen("#303136", 16);
    private static readonly Pen Track = FrozenPen("#9A9CA3", 5);
    private static readonly Pen ApproximateTrack = FrozenPen("#9A9CA3", 5, dashed: true);
    private static readonly Pen Area = FrozenPen("#99DE3341", 5);
    private static readonly Pen CurrentArea = FrozenPen("#DE3341", 7);
    private static readonly Pen StartFinish = FrozenPen("#F3F4F6", 3);
    private static readonly Pen DotOutline = FrozenPen("#FFFFFF", 2.5);
    private static readonly Brush Dot = FrozenBrush("#DE3341");
    private static readonly Brush Label = FrozenBrush("#9A9CA3");
    private static readonly Typeface LabelFace = new("Segoe UI");

    private TrackMap? _map;
    private double? _carPct;
    // The outline in the control's pixels, for the current map and size
    private Point[]? _pixels;
    private Size _pixelsFor;

    public TrackMap? Map
    {
        get => _map;
        set
        {
            if (ReferenceEquals(_map, value))
                return;
            _map = value;
            _pixels = null;
            InvalidateVisual();
        }
    }

    /// <summary>The car's LapDistPct (0-1), or null when it isn't on track.</summary>
    public double? CarPct
    {
        get => _carPct;
        set
        {
            if (_carPct == value)
                return;
            _carPct = value;
            InvalidateVisual();
        }
    }

    /// <summary>The focus area the car is in, or null.</summary>
    public TrackMapArea? AreaAt(double pct) =>
        _map?.Areas.FirstOrDefault(a => a.End >= a.Start ? pct >= a.Start && pct <= a.End : pct >= a.Start || pct <= a.End);

    protected override void OnRender(DrawingContext dc)
    {
        if (_map is not { Points.Count: > 2 } map || ActualWidth < 2 * Inset || ActualHeight < 2 * Inset)
            return;
        var pixels = Pixels(map);
        var n = pixels.Length;

        var outline = Geometry(pixels, 0, n);
        dc.DrawGeometry(null, Casing, outline);
        dc.DrawGeometry(null, map.Exact ? Track : ApproximateTrack, outline);

        var current = _carPct is { } carPct ? AreaAt(carPct) : null;
        var dpi = VisualTreeHelper.GetDpi(this).PixelsPerDip;
        foreach (var area in map.Areas)
        {
            var from = (int)Math.Floor(area.Start * n);
            var to = (int)Math.Ceiling((area.End < area.Start ? area.End + 1 : area.End) * n);
            dc.DrawGeometry(null, area == current ? CurrentArea : Area, Geometry(pixels, from, to - from));
            var middle = pixels[((from + to) / 2 % n + n) % n];
            var text = new FormattedText(area.Name, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, LabelFace, 11,
                area == current ? Dot : Label, dpi);
            dc.DrawText(text, new Point(middle.X + 10, middle.Y - text.Height - 4));
        }

        // Across the track at its first point
        var direction = pixels[1 % n] - pixels[0];
        if (direction.Length > 0)
        {
            direction.Normalize();
            var across = new Vector(-direction.Y, direction.X) * 11;
            dc.DrawLine(StartFinish, pixels[0] - across, pixels[0] + across);
        }

        if (_carPct is { } pct)
            dc.DrawEllipse(Dot, DotOutline, PointAt(pixels, pct), 8, 8);
    }

    // The outline fitted into the control, north (or the drawn lap's start) up
    private Point[] Pixels(TrackMap map)
    {
        var size = new Size(ActualWidth, ActualHeight);
        if (_pixels is not null && _pixelsFor == size)
            return _pixels;
        var (minX, maxX) = (map.Points.Min(p => p.X), map.Points.Max(p => p.X));
        var (minY, maxY) = (map.Points.Min(p => p.Y), map.Points.Max(p => p.Y));
        var scale = Math.Min((size.Width - 2 * Inset) / Math.Max(maxX - minX, 1), (size.Height - 2 * Inset) / Math.Max(maxY - minY, 1));
        var offsetX = (size.Width - (maxX - minX) * scale) / 2;
        var offsetY = (size.Height - (maxY - minY) * scale) / 2;
        _pixels = map.Points.Select(p => new Point(offsetX + (p.X - minX) * scale, offsetY + (maxY - p.Y) * scale)).ToArray();
        _pixelsFor = size;
        return _pixels;
    }

    private static Point PointAt(Point[] pixels, double pct)
    {
        var f = (pct % 1 + 1) % 1 * pixels.Length;
        var i = (int)Math.Floor(f) % pixels.Length;
        var t = f - Math.Floor(f);
        var (a, b) = (pixels[i], pixels[(i + 1) % pixels.Length]);
        return new Point(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t);
    }

    // count points from start round the outline (closed when it's all of it)
    private static StreamGeometry Geometry(Point[] pixels, int start, int count)
    {
        var n = pixels.Length;
        var closed = count >= n;
        var geometry = new StreamGeometry();
        using (var ctx = geometry.Open())
        {
            ctx.BeginFigure(pixels[(start % n + n) % n], false, closed);
            for (var i = 1; i <= Math.Min(count, closed ? n - 1 : count); i++)
                ctx.LineTo(pixels[((start + i) % n + n) % n], true, true);
        }
        geometry.Freeze();
        return geometry;
    }

    private static Pen FrozenPen(string color, double thickness, bool dashed = false)
    {
        var pen = new Pen(FrozenBrush(color), thickness) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round, LineJoin = PenLineJoin.Round };
        if (dashed)
            pen.DashStyle = new DashStyle([0.5, 2.5], 0);
        pen.Freeze();
        return pen;
    }

    private static SolidColorBrush FrozenBrush(string color)
    {
        var brush = (SolidColorBrush)new BrushConverter().ConvertFromString(color)!;
        brush.Freeze();
        return brush;
    }
}
