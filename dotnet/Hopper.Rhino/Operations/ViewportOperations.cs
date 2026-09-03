using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Text;
using Hopper.Rhino.Host;
using Rhino;
using Rhino.Display;
using Rhino.DocObjects;
using Rhino.Geometry;

namespace rhino_zmq_poc
{
    internal static class ViewportOperations
    {
        private const int DefaultWidth = 1280;
        private const int DefaultHeight = 720;
        private const int MaxDimension = 2000;

        public static RhinoCaptureExecution Capture(RhinoDoc doc, RhinoCaptureArguments param)
        {
            try
            {
                if (doc == null)
                    return CaptureFail("No active Rhino document");

                var viewName = string.IsNullOrWhiteSpace(param?.View) ? "active" : param.View.Trim();
                var view = ResolveView(doc, viewName) ?? doc.Views.ActiveView;
                if (view == null)
                    return CaptureFail("No active Rhino view");

                var viewport = view.ActiveViewport;
                var restoreView = param?.RestoreView != false;
                ViewInfo previousViewInfo = null;
                DisplayModeDescription previousDisplayMode = null;

                try
                {
                    if (restoreView)
                        previousViewInfo = new ViewInfo(viewport);

                    var changedProjection = ApplyViewSelector(doc, viewport, viewName);
                    if (!changedProjection && !IsActiveSelector(viewName) && !IsExistingView(doc, viewName))
                        return CaptureFail($"View '{viewName}' was not found as a viewport, standard view, or named view");

                    if (!string.IsNullOrWhiteSpace(param?.DisplayMode))
                    {
                        var displayMode = DisplayModeDescription.FindByName(param.DisplayMode.Trim());
                        if (displayMode == null)
                            return CaptureFail($"Display mode '{param.DisplayMode}' was not found");
                        previousDisplayMode = viewport.DisplayMode;
                        viewport.DisplayMode = displayMode;
                    }

                    view.Redraw();
                    doc.Views.Redraw();

                    var width = ClampDimension(param?.Width, DefaultWidth);
                    var height = ClampDimension(param?.Height, DefaultHeight);
                    var capture = new ViewCapture
                    {
                        Width = width,
                        Height = height,
                        ScaleScreenItems = false,
                        DrawGrid = true,
                        DrawAxes = true,
                        DrawGridAxes = true,
                        TransparentBackground = param?.TransparentBackground == true
                    };

                    using var bitmap = capture.CaptureToBitmap(view);
                    if (bitmap == null)
                        return CaptureFail("Rhino returned no bitmap for the view capture");

                    using var stream = new MemoryStream();
                    bitmap.Save(stream, ImageFormat.Png);

                    return new RhinoCaptureExecution(
                        true,
                        Convert.ToBase64String(stream.ToArray()),
                        "image/png",
                        null,
                        BuildMetadata(viewport, width, height));
                }
                finally
                {
                    if (previousDisplayMode != null)
                        viewport.DisplayMode = previousDisplayMode;
                    if (restoreView && previousViewInfo != null)
                    {
                        viewport.SetViewProjection(previousViewInfo.Viewport, false);
                        previousViewInfo.Dispose();
                    }
                    view.Redraw();
                    doc.Views.Redraw();
                }
            }
            catch (Exception ex)
            {
                return CaptureFail($"{ex.GetType().Name}: {ex.Message}");
            }
        }

        public static RhinoControlExecution Control(RhinoDoc doc, RhinoControlArguments param)
        {
            try
            {
                if (doc == null)
                    return ControlFail("No active Rhino document");
                if (param == null || string.IsNullOrWhiteSpace(param.Action))
                    return ControlFail("action is required");

                var view = doc.Views.ActiveView;
                if (view == null)
                    return ControlFail("No active Rhino view");

                var viewport = view.ActiveViewport;
                var action = param.Action.Trim();
                string message;

                switch (action)
                {
                    case "setActiveView":
                        view = ResolveView(doc, param.ViewName);
                        if (view == null)
                            return ControlFail($"View '{param.ViewName}' was not found");
                        SetActiveViewport(doc, view);
                        viewport = view.ActiveViewport;
                        message = $"Active Rhino view set to '{viewport.Name}'.";
                        break;
                    case "standardView":
                        if (!ApplyStandardView(viewport, param.StandardView))
                            return ControlFail($"Unsupported standardView '{param.StandardView}'");
                        message = $"Rhino view changed to standard view '{param.StandardView}'.";
                        break;
                    case "namedView":
                        if (!RestoreNamedView(doc, viewport, param.NamedView))
                            return ControlFail($"Named view '{param.NamedView}' was not found");
                        message = $"Rhino named view '{param.NamedView}' restored.";
                        break;
                    case "cplaneView":
                        if (!ApplyCPlaneView(doc, viewport, param.CPlaneName))
                            return ControlFail(string.IsNullOrWhiteSpace(param.CPlaneName)
                                ? "Could not align view to the active construction plane"
                                : $"Named construction plane '{param.CPlaneName}' was not found");
                        message = string.IsNullOrWhiteSpace(param.CPlaneName)
                            ? "Rhino view aligned to the active construction plane."
                            : $"Rhino view aligned to construction plane '{param.CPlaneName}'.";
                        break;
                    case "camera":
                        if (!ApplyCamera(viewport, param.Camera, out var cameraError))
                            return ControlFail(cameraError);
                        message = "Rhino camera updated.";
                        break;
                    case "zoom":
                        if (!ApplyZoom(viewport, param.Zoom, out var zoomError))
                            return ControlFail(zoomError);
                        message = $"Rhino view zoom updated ({param.Zoom?.Mode}).";
                        break;
                    case "saveNamedView":
                        if (string.IsNullOrWhiteSpace(param.NamedView))
                            return ControlFail("saveNamedView requires namedView");
                        var index = doc.NamedViews.Add(param.NamedView.Trim(), viewport.Id);
                        if (index < 0)
                            return ControlFail($"Could not save named view '{param.NamedView}'");
                        message = $"Rhino named view '{param.NamedView}' saved.";
                        break;
                    default:
                        return ControlFail($"Unsupported action '{param.Action}'");
                }

                view.Redraw();
                doc.Views.Redraw();

                return new RhinoControlExecution(
                    true,
                    message,
                    null,
                    BuildMetadata(viewport, null, null));
            }
            catch (Exception ex)
            {
                return ControlFail($"{ex.GetType().Name}: {ex.Message}");
            }
        }

        private static int ClampDimension(int? value, int fallback)
        {
            var n = value.GetValueOrDefault(fallback);
            return Math.Min(Math.Max(n, 64), MaxDimension);
        }

        private static RhinoCaptureExecution CaptureFail(string error) =>
            new(false, "", "image/png", error, null);

        private static RhinoControlExecution ControlFail(string error) =>
            new(false, "", error, null);

        private static bool IsActiveSelector(string raw)
            => string.IsNullOrWhiteSpace(raw) || raw.Trim().Equals("active", StringComparison.OrdinalIgnoreCase);

        private static RhinoView ResolveView(RhinoDoc doc, string raw)
        {
            if (doc == null || IsActiveSelector(raw))
                return doc?.Views.ActiveView;

            var value = raw.Trim();
            if (Guid.TryParse(value, out var id))
                return doc.Views.Find(id);

            return doc.Views.Find(value, false);
        }

        private static bool IsExistingView(RhinoDoc doc, string raw)
            => ResolveView(doc, raw) != null;

        private static bool ApplyViewSelector(RhinoDoc doc, RhinoViewport viewport, string raw)
        {
            if (IsActiveSelector(raw))
                return true;
            if (ApplyStandardView(viewport, raw))
                return true;
            return RestoreNamedView(doc, viewport, raw);
        }

        private static bool ApplyStandardView(RhinoViewport viewport, string raw)
        {
            if (viewport == null || string.IsNullOrWhiteSpace(raw))
                return false;

            var key = raw.Trim().Replace(" ", "").Replace("-", "").ToLowerInvariant();
            if (key == "twopointperspective" || key == "2pointperspective")
                return viewport.ChangeToTwoPointPerspectiveProjection(viewport.Camera35mmLensLength);

            var enumName = key switch
            {
                "top" => "Top",
                "bottom" => "Bottom",
                "front" => "Front",
                "back" => "Back",
                "left" => "Left",
                "right" => "Right",
                "perspective" => "Perspective",
                _ => null
            };

            if (enumName == null)
                return false;

            return Enum.TryParse(enumName, true, out DefinedViewportProjection projection)
                && viewport.SetProjection(projection, enumName, true);
        }

        private static bool RestoreNamedView(RhinoDoc doc, RhinoViewport viewport, string raw)
        {
            if (doc == null || viewport == null || string.IsNullOrWhiteSpace(raw))
                return false;
            var index = doc.NamedViews.FindByName(raw.Trim());
            return index >= 0 && doc.NamedViews.Restore(index, viewport);
        }

        private static bool ApplyCPlaneView(RhinoDoc doc, RhinoViewport viewport, string cplaneName)
        {
            if (doc == null || viewport == null)
                return false;

            ConstructionPlane cplane;
            if (string.IsNullOrWhiteSpace(cplaneName))
            {
                cplane = viewport.GetConstructionPlane();
            }
            else
            {
                var index = doc.NamedConstructionPlanes.Find(cplaneName.Trim());
                if (index < 0)
                    return false;
                cplane = doc.NamedConstructionPlanes[index];
            }

            viewport.SetConstructionPlane(cplane);
            var plane = cplane.Plane;
            viewport.SetToPlanView(plane.Origin, plane.XAxis, plane.YAxis, true);
            return true;
        }

        private static bool ApplyCamera(RhinoViewport viewport, RhinoCameraArguments camera, out string error)
        {
            error = null;
            if (viewport == null)
            {
                error = "No active Rhino viewport";
                return false;
            }
            if (camera == null)
            {
                error = "camera settings are required";
                return false;
            }

            if (!string.IsNullOrWhiteSpace(camera.Projection))
            {
                var projection = camera.Projection.Trim();
                if (projection.Equals("parallel", StringComparison.OrdinalIgnoreCase))
                    viewport.ChangeToParallelProjection(true);
                else if (projection.Equals("perspective", StringComparison.OrdinalIgnoreCase))
                    viewport.ChangeToPerspectiveProjection(true, camera.LensLength.GetValueOrDefault(viewport.Camera35mmLensLength));
                else if (projection.Equals("twoPointPerspective", StringComparison.OrdinalIgnoreCase))
                    viewport.ChangeToTwoPointPerspectiveProjection(camera.LensLength.GetValueOrDefault(viewport.Camera35mmLensLength));
                else
                {
                    error = $"Unsupported camera projection '{camera.Projection}'";
                    return false;
                }
            }

            if (camera.LensLength.HasValue)
                viewport.Camera35mmLensLength = camera.LensLength.Value;

            var hasLocation = camera.Location != null;
            var hasTarget = camera.Target != null;
            if (hasLocation && hasTarget)
                viewport.SetCameraLocations(ToPoint(camera.Target), ToPoint(camera.Location));
            else if (hasLocation)
                viewport.SetCameraLocation(ToPoint(camera.Location), false);
            else if (hasTarget)
                viewport.SetCameraTarget(ToPoint(camera.Target), false);

            return true;
        }

        private static bool ApplyZoom(RhinoViewport viewport, RhinoZoomArguments zoom, out string error)
        {
            error = null;
            if (viewport == null)
            {
                error = "No active Rhino viewport";
                return false;
            }
            if (zoom == null || string.IsNullOrWhiteSpace(zoom.Mode))
            {
                error = "zoom.mode is required";
                return false;
            }

            switch (zoom.Mode.Trim())
            {
                case "extents":
                    viewport.ZoomExtents();
                    return true;
                case "selected":
                    viewport.ZoomExtentsSelected();
                    return true;
                case "boundingBox":
                    if (zoom.Min == null || zoom.Max == null)
                    {
                        error = "zoom boundingBox requires min and max";
                        return false;
                    }
                    viewport.ZoomBoundingBox(new BoundingBox(ToPoint(zoom.Min), ToPoint(zoom.Max)));
                    return true;
                default:
                    error = $"Unsupported zoom mode '{zoom.Mode}'";
                    return false;
            }
        }

        private static void SetActiveViewport(RhinoDoc doc, RhinoView view)
        {
            var sanitized = SanitizeMacroArgument(view?.ActiveViewport?.Name);
            if (sanitized == null)
                return;
            RhinoApp.RunScript(doc.RuntimeSerialNumber, $"_-SetActiveViewport \"{sanitized}\"", "Hopper agent", false);
        }

        private static string SanitizeMacroArgument(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
                return null;

            var result = new StringBuilder(value.Length);
            foreach (var character in value.Trim())
            {
                if (character < 0x20)
                    continue;
                if (character == '\\')
                    result.Append("\\\\");
                else if (character == '"')
                    result.Append("\\\"");
                else
                    result.Append(character);
            }
            return result.Length == 0 ? null : result.ToString();
        }

        private static Point3d ToPoint(RhinoPoint3 point)
            => new Point3d(point.X, point.Y, point.Z);

        private static RhinoPoint3 ToDto(Point3d point)
            => new RhinoPoint3(point.X, point.Y, point.Z);

        private static RhinoPoint3 ToDto(Vector3d vector)
            => new RhinoPoint3(vector.X, vector.Y, vector.Z);

        private static RhinoViewMetadata BuildMetadata(RhinoViewport viewport, int? width, int? height)
        {
            var cplane = viewport.GetConstructionPlane();
            var projection = viewport.IsTwoPointPerspectiveProjection
                ? "twoPointPerspective"
                : viewport.IsPerspectiveProjection
                    ? "perspective"
                    : viewport.IsParallelProjection
                        ? "parallel"
                        : viewport.ViewportType.ToString();

            return new RhinoViewMetadata(
                viewport.Name ?? "",
                viewport.Id.ToString(),
                projection,
                ToDto(viewport.CameraLocation),
                ToDto(viewport.CameraTarget),
                ToDto(viewport.CameraDirection),
                ToDto(viewport.CameraUp),
                viewport.Camera35mmLensLength,
                cplane.Name ?? "",
                ToDto(cplane.Plane.Origin),
                width,
                height);
        }
    }
}
