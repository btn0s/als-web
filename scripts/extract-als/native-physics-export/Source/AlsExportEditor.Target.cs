using UnrealBuildTool;
public class AlsExportEditorTarget : TargetRules {
 public AlsExportEditorTarget(TargetInfo Target) : base(Target) {
  Type = TargetType.Editor;
  DefaultBuildSettings = BuildSettingsVersion.Latest;
  IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
  ExtraModuleNames.Add("AlsExport");
 }
}
