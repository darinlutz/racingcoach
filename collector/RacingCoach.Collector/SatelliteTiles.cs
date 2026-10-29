using System.Text.Json;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace RacingCoach.Collector;

/// <summary>
/// The satellite imagery under the Live Racing tab's map (TrackMapView), as on the website's Live Racing page
/// (LiveTrackMap.tsx, src/lib/satelliteImagery.ts): Web Mercator tiles from the site's /api/map-tiles (upload key
/// auth, so the provider's key stays on the server), sharpened the same way, and kept in memory once loaded. Nothing
/// is shown when the site has no imagery set up (SATELLITE_TILE_URL).
/// </summary>
internal sealed class SatelliteTiles(Func<RacingCoachApi?> api)
{
    public const int TileSize = 256;
    // Web Mercator: meters per pixel at the equator at zoom 0 (256 px tiles)
    public const double MetersPerPixelZ0 = 156543.03392;
    // Must match MAX_TILE_ZOOM in src/lib/mapTiles.ts
    public const int MaxZoom = 19;
    // The website's SHARPEN: an unsharp mask pushing each pixel away from its 4 neighbors by this much
    private const double Sharpen = 0.35;
    private const int MaxCached = 400;
    private const int MaxLoading = 6;
    private static readonly TimeSpan SettingsRetry = TimeSpan.FromMinutes(2);

    private readonly object _lock = new();
    private readonly Dictionary<(int Z, int X, int Y), BitmapSource?> _tiles = [];
    private readonly HashSet<(int Z, int X, int Y)> _loading = [];
    private readonly SemaphoreSlim _slots = new(MaxLoading);
    private RacingCoachApi? _for;
    private MapSettings? _settings;
    private bool _settingsLoading;
    private DateTime _settingsAt;

    /// <summary>Raised (on a background thread) when a tile or the settings arrive.</summary>
    public event Action? Changed;

    /// <summary>[lat, lon] in degrees as Web Mercator pixels at zoom 0 (the world is 256 px across).</summary>
    public static (double X, double Y) Project(double lat, double lon)
    {
        var phi = lat * Math.PI / 180;
        return ((lon + 180) / 360 * TileSize, (1 - Math.Log(Math.Tan(phi) + 1 / Math.Cos(phi)) / Math.PI) / 2 * TileSize);
    }

    /// <summary>The site's imagery settings when they're loaded and imagery is set up, else null (loading them the
    /// first time, or again a while after they failed).</summary>
    public MapSettings? Available
    {
        get
        {
            var client = api();
            if (client is null)
                return null;
            lock (_lock)
            {
                if (_for != client)
                {
                    _for = client;
                    _settings = null;
                    _settingsAt = default;
                    _tiles.Clear();
                }
                if (_settings is null && !_settingsLoading && DateTime.UtcNow - _settingsAt >= SettingsRetry)
                {
                    _settingsLoading = true;
                    _settingsAt = DateTime.UtcNow;
                    _ = LoadSettingsAsync(client);
                }
                return _settings is { Available: true } settings ? settings : null;
            }
        }
    }

    /// <summary>A tile once it's loaded, else null (loading it unless it failed).</summary>
    public BitmapSource? Tile(int zoom, int x, int y)
    {
        var key = (zoom, x, y);
        RacingCoachApi? client;
        lock (_lock)
        {
            if (_tiles.TryGetValue(key, out var tile))
                return tile;
            client = _for;
            if (client is null || !_loading.Add(key))
                return null;
        }
        _ = LoadTileAsync(client, key);
        return null;
    }

    private async Task LoadSettingsAsync(RacingCoachApi client)
    {
        MapSettings? settings = null;
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            settings = await client.GetMapSettingsAsync(timeout.Token);
        }
        catch (Exception e) when (e is HttpRequestException or UnauthorizedAccessException or JsonException or TaskCanceledException)
        {
            // asked again later
        }
        lock (_lock)
        {
            _settingsLoading = false;
            if (_for == client)
                _settings = settings;
        }
        if (settings is not null)
            Changed?.Invoke();
    }

    private async Task LoadTileAsync(RacingCoachApi client, (int Z, int X, int Y) key)
    {
        BitmapSource? tile = null;
        await _slots.WaitAsync();
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            if (await client.GetMapTileAsync(key.Z, key.X, key.Y, timeout.Token) is { } bytes)
                tile = Sharpened(bytes);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or NotSupportedException or ArgumentException
                                      or InvalidOperationException or System.IO.IOException)
        {
            // left out, like the website's tiles that fail to load
        }
        finally
        {
            _slots.Release();
        }
        lock (_lock)
        {
            _loading.Remove(key);
            if (_for != client)
                return;
            if (_tiles.Count >= MaxCached)
                _tiles.Clear();
            _tiles[key] = tile;
        }
        Changed?.Invoke();
    }

    // The image decoded and sharpened with the website's 3x3 kernel (center 1 + 4s, the 4 neighbors -s; edges
    // duplicated, alpha kept), frozen so the window can draw it
    private static BitmapSource Sharpened(byte[] bytes)
    {
        var image = new BitmapImage();
        image.BeginInit();
        image.CacheOption = BitmapCacheOption.OnLoad;
        image.StreamSource = new MemoryStream(bytes);
        image.EndInit();
        var bgra = new FormatConvertedBitmap(image, PixelFormats.Bgra32, null, 0);
        var (w, h) = (bgra.PixelWidth, bgra.PixelHeight);
        var stride = w * 4;
        var source = new byte[stride * h];
        bgra.CopyPixels(source, stride, 0);
        var result = new byte[source.Length];
        for (var y = 0; y < h; y++)
        {
            var (up, down) = (Math.Max(y - 1, 0) * stride, Math.Min(y + 1, h - 1) * stride);
            for (var x = 0; x < w; x++)
            {
                var (left, right) = (Math.Max(x - 1, 0) * 4, Math.Min(x + 1, w - 1) * 4);
                var i = y * stride + x * 4;
                for (var c = 0; c < 3; c++)
                {
                    var neighbors = source[up + x * 4 + c] + source[down + x * 4 + c] + source[y * stride + left + c] + source[y * stride + right + c];
                    var value = (1 + 4 * Sharpen) * source[i + c] - Sharpen * neighbors;
                    result[i + c] = (byte)Math.Clamp(Math.Round(value), 0, 255);
                }
                result[i + 3] = source[i + 3];
            }
        }
        var sharpened = BitmapSource.Create(w, h, 96, 96, PixelFormats.Bgra32, null, result, stride);
        sharpened.Freeze();
        return sharpened;
    }
}
