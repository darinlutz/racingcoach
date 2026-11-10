using System.Buffers.Binary;
using System.Numerics;
using System.Text;
using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector.Core.Tests;

/// <summary>Pages laid out from a Kunos document's field list (AccDocumentedLayout, AcDocumentedLayout) by C's rules,
/// with markers written by field, for the layout tests of both games' readers.</summary>
internal static class DocumentedPages
{
    // C's layout of the fields in order: 4-byte values 4-byte aligned, wchar_t 2-byte, the struct a multiple of 4
    public static (Dictionary<string, int> Offsets, int Size) Layout(DocumentedField[] fields)
    {
        var offsets = new Dictionary<string, int>();
        var offset = 0;
        foreach (var field in fields)
        {
            var (size, align) = field.Type == FieldType.WChar ? (2, 2) : (4, 4);
            offset = (offset + align - 1) / align * align;
            offsets.Add(field.Name, offset);
            offset += size * field.Count;
        }
        return (offsets, (offset + 3) / 4 * 4);
    }

    // A page with a marker in each field the predicate picks: element i of an int field is 7 + i, of a float 1.5 + i,
    // and a string is the field's name, cut to fit with its NUL
    public static byte[] Build(DocumentedField[] fields, Func<DocumentedField, bool> mark)
    {
        var (offsets, size) = Layout(fields);
        var bytes = new byte[size];
        foreach (var field in fields.Where(mark))
        {
            var at = offsets[field.Name];
            switch (field.Type)
            {
                case FieldType.Int:
                    for (var i = 0; i < field.Count; i++)
                        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(at + 4 * i), 7 + i);
                    break;
                case FieldType.Float:
                    for (var i = 0; i < field.Count; i++)
                        BinaryPrimitives.WriteSingleLittleEndian(bytes.AsSpan(at + 4 * i), 1.5f + i);
                    break;
                case FieldType.WChar:
                    Encoding.Unicode.GetBytes(StringMarker(field)).CopyTo(bytes, at);
                    break;
            }
        }
        return bytes;
    }

    public static string StringMarker(DocumentedField field) => field.Name[..Math.Min(field.Name.Length, field.Count - 1)];

    // What the parser should give for a marked field, in Normalize's form
    public static object Marker(DocumentedField field, object parsed) => parsed switch
    {
        string => StringMarker(field),
        bool => "1",
        _ => string.Join(",", Enumerable.Range(0, field.Count).Select(i => field.Type == FieldType.Int ? (7 + i).ToString() : (1.5f + i).ToString("R"))),
    };

    public static object Zero(DocumentedField field, object parsed) => parsed switch
    {
        string => "",
        bool => "0",
        _ => string.Join(",", Enumerable.Repeat("0", field.Count)),
    };

    public static object Normalize(object value) => value switch
    {
        string s => s,
        bool b => b ? "1" : "0",
        Enum e => Convert.ToInt32(e).ToString(),
        int i => i.ToString(),
        float f => f.ToString("R"),
        Vector3 v => $"{v.X:R},{v.Y:R},{v.Z:R}",
        float[] values => string.Join(",", values.Select(f => f.ToString("R"))),
        AccWheels w => $"{w.FrontLeft:R},{w.FrontRight:R},{w.RearLeft:R},{w.RearRight:R}",
        AccCarDamage d => $"{d.Front:R},{d.Rear:R},{d.Left:R},{d.Right:R},{d.Centre:R}",
        _ => throw new ArgumentException($"no normal form for {value.GetType()}"),
    };
}
