using System;
using System.Text;

namespace Hopper.Rhino.Host;

internal sealed class HostStartupErrorBuffer
{
    internal const int MaximumLength = 16 * 1024;

    private readonly StringBuilder _message = new();

    public void Reset() => _message.Clear();

    public string Append(string line)
    {
        if (string.IsNullOrWhiteSpace(line) || _message.Length >= MaximumLength)
            return _message.ToString();

        if (_message.Length > 0)
        {
            var separator = Environment.NewLine;
            var separatorLength = Math.Min(separator.Length, MaximumLength - _message.Length);
            _message.Append(separator, 0, separatorLength);
        }

        var available = MaximumLength - _message.Length;
        if (available > 0)
            _message.Append(line, 0, Math.Min(line.Length, available));
        return _message.ToString();
    }
}
