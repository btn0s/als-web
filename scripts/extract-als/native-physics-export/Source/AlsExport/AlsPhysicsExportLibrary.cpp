#include "AlsPhysicsExportLibrary.h"
#include "Components/SkeletalMeshComponent.h"
#include "PhysicsEngine/BodyInstance.h"
#include "PhysicsEngine/PhysicsAsset.h"
#include "PhysicsEngine/PhysicsConstraintTemplate.h"
#include "Modules/ModuleManager.h"
#include "JsonObjectConverter.h"
IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, AlsExport, "AlsExport");
FTransform UAlsPhysicsExportLibrary::GetBodyMassSpace(USkeletalMeshComponent* Mesh, FName Bone) {
 const FBodyInstance* Body = Mesh ? Mesh->GetBodyInstance(Bone) : nullptr;
 check(Body);
 return Body->GetMassSpaceLocal();
}
FString UAlsPhysicsExportLibrary::GetConstraintInstanceText(UPhysicsAsset* Asset, int32 Index) {
 check(Asset && Asset->ConstraintSetup.IsValidIndex(Index));
 FString Text;
 const FConstraintInstance& Instance = Asset->ConstraintSetup[Index]->DefaultInstance;
 FJsonObjectConverter::UStructToFormattedJsonObjectString<TCHAR, TCondensedJsonPrintPolicy>(FConstraintInstance::StaticStruct(), &Instance, Text, 0, 0, 0, nullptr, EJsonObjectConversionFlags::SkipStandardizeCase);
 return Text;
}
