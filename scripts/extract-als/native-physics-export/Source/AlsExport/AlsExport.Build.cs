using UnrealBuildTool;
public class AlsExport : ModuleRules {
 public AlsExport(ReadOnlyTargetRules Target) : base(Target) {
  PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
  PublicDependencyModuleNames.AddRange(new[] {"Core", "CoreUObject", "Engine", "Json", "JsonUtilities"});
 }
}
