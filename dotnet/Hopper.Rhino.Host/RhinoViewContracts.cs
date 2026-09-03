namespace Hopper.Rhino.Host;

public sealed record RhinoPoint3(double X, double Y, double Z);

public sealed record RhinoViewMetadata(
    string ViewName,
    string ViewportId,
    string Projection,
    RhinoPoint3 CameraLocation,
    RhinoPoint3 CameraTarget,
    RhinoPoint3 CameraDirection,
    RhinoPoint3 CameraUp,
    double LensLength,
    string CPlaneName,
    RhinoPoint3 CPlaneOrigin,
    int? Width,
    int? Height);

public sealed record RhinoCaptureArguments(
    string? View,
    int? Width,
    int? Height,
    string? DisplayMode,
    bool? TransparentBackground,
    bool? RestoreView);

public sealed record RhinoCaptureExecution(
    bool Succeeded,
    string ImageBase64,
    string MediaType,
    string? Error,
    RhinoViewMetadata? Metadata);

public sealed record RhinoCameraArguments(
    RhinoPoint3? Location,
    RhinoPoint3? Target,
    double? LensLength,
    string? Projection);

public sealed record RhinoZoomArguments(
    string? Mode,
    RhinoPoint3? Min,
    RhinoPoint3? Max);

public sealed record RhinoControlArguments(
    string? Action,
    string? ViewName,
    string? StandardView,
    string? NamedView,
    string? CPlaneName,
    RhinoCameraArguments? Camera,
    RhinoZoomArguments? Zoom);

public sealed record RhinoControlExecution(
    bool Succeeded,
    string Message,
    string? Error,
    RhinoViewMetadata? Metadata);

public sealed record RhinoTransactionExecution(
    bool Succeeded,
    string Result,
    string? Error = null);
