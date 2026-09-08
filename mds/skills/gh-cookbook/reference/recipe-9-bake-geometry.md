# Recipe 9: Reusable bake pipeline

Build a Rhino 8+ GH pipeline that attaches layer attributes to geometry and passes model content to Content Cache. For a direct/current bake, follow [rhino-document](../../rhino-document/SKILL.md).

```text
Layer-name panel, Colour Swatch -> Model Layer
Geometry, Model Layer ---------> Model Object
Model Object ------------------> Content Cache content
```

Use a layer path such as `Structure::Frames`. Confirm available component ports and the Content Cache action controls in the installed Rhino version.

Model Object attaches attributes; connecting it does not prove that Rhino objects were created. Content Cache needs an action. Push tracks output for later updates; Bake can create duplicates. Existing object IDs can cause replacement in either mode. An exposed Action input can automate this behavior; a Boolean true runs the configured default action. See McNeel's [Content Cache guide](https://discourse.mcneel.com/t/content-cache-updated-guide/181883/1).

The configured pipeline produces model content. Report Rhino geometry as created only after the intended action completes and document queries confirm its IDs and layer. Keep pipeline configuration and actual model mutation distinct when following the Rhino workflow.
