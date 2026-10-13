#pragma once
#include "Kismet/BlueprintFunctionLibrary.h"
#include "AlsPhysicsExportLibrary.generated.h"
class USkeletalMeshComponent;
class UPhysicsAsset;
UCLASS()
class ALSEXPORT_API UAlsPhysicsExportLibrary : public UBlueprintFunctionLibrary {
 GENERATED_BODY()
public:
 UFUNCTION(BlueprintCallable) static FTransform GetBodyMassSpace(USkeletalMeshComponent* Mesh, FName Bone);
 UFUNCTION(BlueprintCallable) static FString GetConstraintInstanceText(UPhysicsAsset* Asset, int32 Index);
};
