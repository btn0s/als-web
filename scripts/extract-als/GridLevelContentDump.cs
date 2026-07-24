using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Freezes the small L_Als_Grid presentation contract into a compact oracle.
// The level uses World Partition external actors, so inspecting the .umap alone
// misses the floor, sky, skylight, and post-process volume.
public static class GridLevelContentDump
{
    const string LevelAsset = "L_Als_Grid";
    const string GridMaterialAsset = "M_Als_Grid";
    const string SkyMaterialAsset = "M_Als_SkySphere";
    const string FloorMeshAsset = "SM_Als_Floor_1x1Km";
    const string SkyLightTextureAsset = "TC_Als_WhiteLight_HDRI";
    const string LevelContentPath = "/Content/ALSExtras/Levels/";
    const string ExternalActorsPath =
        "/Content/__ExternalActors__/ALSExtras/Levels/L_Als_Grid/";
    const string EnvironmentContentPath = "/Content/ALSExtras/Environment/";

    static readonly JsonSerializer Serializer = JsonSerializer.Create(
        new JsonSerializerSettings
        {
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
        });

    public static int Run(string srcDir, string outJson)
    {
        var provider = new DefaultFileProvider(
            srcDir,
            SearchOption.AllDirectories,
            new VersionContainer(EGame.GAME_UE5_5));
        provider.Initialize();
        provider.Mount();

        var (levelPath, levelExports) = LoadPackageExports(
            provider,
            LevelAsset,
            "umap",
            LevelContentPath);
        var externalPackages = provider.Files.Values
            .Where(
                file =>
                    file.Extension == "uasset"
                    && NormalizePath(file.Path).Contains(
                        ExternalActorsPath,
                        StringComparison.Ordinal))
            .OrderBy(file => file.Path, StringComparer.Ordinal)
            .ToArray();
        var externalExports = externalPackages
            .SelectMany(file => provider.LoadPackage(file).GetExports())
            .Select(Serialize)
            .ToArray();

        var postProcess = SingleExport(externalExports, "PostProcessVolume");
        var floorActor = SingleActor(externalExports, "StaticMeshActor", "Floor");
        var floorComponent = ComponentForActor(
            externalExports,
            floorActor,
            "StaticMeshComponent");
        var skyActor = SingleActor(externalExports, "StaticMeshActor", "SkySphere");
        var skyComponent = ComponentForActor(
            externalExports,
            skyActor,
            "StaticMeshComponent");
        var skyLight = SingleExport(externalExports, "SkyLight");
        var skyLightComponent = ComponentForActor(
            externalExports,
            skyLight,
            "SkyLightComponent");

        var (_, gridMaterialExports) = LoadPackageExports(
            provider,
            GridMaterialAsset,
            "uasset",
            EnvironmentContentPath);
        var (_, skyMaterialExports) = LoadPackageExports(
            provider,
            SkyMaterialAsset,
            "uasset",
            EnvironmentContentPath);
        var (_, floorMeshExports) = LoadPackageExports(
            provider,
            FloorMeshAsset,
            "uasset",
            EnvironmentContentPath);
        var (_, skyLightTextureExports) = LoadPackageExports(
            provider,
            SkyLightTextureAsset,
            "uasset",
            EnvironmentContentPath);

        var gridMaterial = SameNamedExport(
            gridMaterialExports,
            GridMaterialAsset);
        var gridMaterialEditorData = SingleExport(
            gridMaterialExports.Select(Serialize),
            "MaterialEditorOnlyData");
        var skyMaterial = SameNamedExport(
            skyMaterialExports,
            SkyMaterialAsset);
        var skyMaterialEditorData = SingleExport(
            skyMaterialExports.Select(Serialize),
            "MaterialEditorOnlyData");
        var floorMesh = SameNamedExport(floorMeshExports, FloorMeshAsset);
        var skyLightTexture = SameNamedExport(
            skyLightTextureExports,
            SkyLightTextureAsset);
        var worldSettings = SingleExport(
            levelExports.Select(Serialize),
            "WorldSettings");

        var payload = new JObject
        {
            ["schemaVersion"] = 1,
            ["source"] = new JObject
            {
                ["engineVersion"] = "UE5.5",
                ["referenceRelease"] = "ALS Refactored 4.15",
                ["levelAssetPath"] = levelPath,
                ["externalActorAssetPaths"] = new JArray(
                    externalPackages.Select(file => file.Path)),
            },
            ["world"] = new JObject
            {
                ["bForceNoPrecomputedLighting"] = RequiredBool(
                    Properties(worldSettings),
                    "bForceNoPrecomputedLighting"),
            },
            ["postProcess"] = NormalizePostProcess(postProcess),
            ["floor"] = NormalizeFloor(floorActor, floorComponent, floorMesh),
            ["gridMaterial"] = NormalizeGridMaterial(
                gridMaterial,
                gridMaterialEditorData,
                gridMaterialExports),
            ["skySphere"] = NormalizeSkySphere(
                skyActor,
                skyComponent,
                skyMaterial,
                skyMaterialEditorData,
                skyMaterialExports),
            ["skyLight"] = NormalizeSkyLight(
                skyLight,
                skyLightComponent,
                skyLightTexture),
        };

        var validations = ValidatePayload(payload);
        payload["validations"] = validations;

        Directory.CreateDirectory(
            Path.GetDirectoryName(Path.GetFullPath(outJson))
            ?? throw new Exception($"invalid output path {outJson}"));
        File.WriteAllText(outJson, payload.ToString(Formatting.Indented) + "\n");

        PrintValidations(validations);
        ThrowOnValidationFailure(validations);
        Console.WriteLine(
            $"dumped {LevelAsset} with {externalPackages.Length} external actors " +
            $"-> {outJson} ({new FileInfo(outJson).Length:N0} bytes)");
        return 0;
    }

    public static int Validate(string gridLevelJson)
    {
        var payload = JObject.Parse(File.ReadAllText(gridLevelJson));
        var validations = ValidatePayload(payload);
        PrintValidations(validations);
        ThrowOnValidationFailure(validations);
        Console.WriteLine($"validated {gridLevelJson}");
        return 0;
    }

    static JObject NormalizePostProcess(JObject postProcess)
    {
        var properties = Properties(postProcess);
        var settings = RequiredObject(properties, "Settings");
        return new JObject
        {
            ["bUnbound"] = RequiredBool(properties, "bUnbound"),
            ["settings"] = new JObject
            {
                ["bOverride_AutoExposureMinBrightness"] = RequiredBool(
                    settings,
                    "bOverride_AutoExposureMinBrightness"),
                ["bOverride_AutoExposureMaxBrightness"] = RequiredBool(
                    settings,
                    "bOverride_AutoExposureMaxBrightness"),
                ["bOverride_AutoExposureBias"] = RequiredBool(
                    settings,
                    "bOverride_AutoExposureBias"),
                ["bOverride_VignetteIntensity"] = RequiredBool(
                    settings,
                    "bOverride_VignetteIntensity"),
                ["bOverride_MotionBlurAmount"] = RequiredBool(
                    settings,
                    "bOverride_MotionBlurAmount"),
                ["AutoExposureBias"] = RequiredNumber(
                    settings,
                    "AutoExposureBias"),
                ["AutoExposureMinBrightness"] = RequiredNumber(
                    settings,
                    "AutoExposureMinBrightness"),
                ["AutoExposureMaxBrightness"] = RequiredNumber(
                    settings,
                    "AutoExposureMaxBrightness"),
                ["VignetteIntensity"] = RequiredNumber(
                    settings,
                    "VignetteIntensity"),
                ["MotionBlurAmount"] = RequiredNumber(
                    settings,
                    "MotionBlurAmount"),
            },
        };
    }

    static JObject NormalizeFloor(
        JObject actor,
        JObject component,
        UObject floorMesh)
    {
        var componentProperties = Properties(component);
        var meshProperties = Properties(Serialize(floorMesh));
        var boxExtent = RequiredObject(
            RequiredObject(meshProperties, "ExtendedBounds"),
            "BoxExtent");
        return new JObject
        {
            ["actorLabel"] = RequiredString(Properties(actor), "ActorLabel"),
            ["mesh"] = ReferenceName(
                RequiredObject(componentProperties, "StaticMesh")
                    .Value<string>("ObjectName")
                ?? throw new Exception("floor StaticMesh has no ObjectName")),
            ["material"] = ReferenceName(
                RequiredArray(componentProperties, "OverrideMaterials")
                    .Single()
                    .Value<string>("ObjectName")
                ?? throw new Exception(
                    "floor OverrideMaterials entry has no ObjectName")),
            ["CastShadow"] = RequiredBool(componentProperties, "CastShadow"),
            ["boundsExtentCm"] = VectorXYZ(boxExtent),
        };
    }

    static JObject NormalizeGridMaterial(
        UObject materialExport,
        JObject editorData,
        IEnumerable<UObject> exports)
    {
        var properties = Properties(Serialize(materialExport));
        var editorProperties = Properties(editorData);
        return new JObject
        {
            ["BlendMode"] = RequiredString(properties, "BlendMode"),
            ["ShadingModel"] = RequiredString(properties, "ShadingModel"),
            ["TwoSided"] = RequiredBool(properties, "TwoSided"),
            ["EmissiveColor"] = RequiredObject(
                RequiredObject(editorProperties, "EmissiveColor"),
                "Constant"),
            ["OpacityExpression"] = ReferenceName(
                RequiredObject(
                        RequiredObject(editorProperties, "Opacity"),
                        "Expression")
                    .Value<string>("ObjectName")
                ?? throw new Exception(
                    "grid material Opacity expression has no ObjectName")),
            ["parameters"] = NormalizeScalarParameters(exports),
            ["expressions"] = NormalizeExpressions(exports),
        };
    }

    static JObject NormalizeSkySphere(
        JObject actor,
        JObject component,
        UObject materialExport,
        JObject editorData,
        IEnumerable<UObject> exports)
    {
        var componentProperties = Properties(component);
        var materialProperties = Properties(Serialize(materialExport));
        var vectorParameter = exports.Single(
            export => export.ExportType == "MaterialExpressionVectorParameter");
        var parameterProperties = Properties(Serialize(vectorParameter));
        var emissive = RequiredObject(
            Properties(editorData),
            "EmissiveColor");
        return new JObject
        {
            ["actorLabel"] = RequiredString(Properties(actor), "ActorLabel"),
            ["mesh"] = ReferenceName(
                RequiredObject(componentProperties, "StaticMesh")
                    .Value<string>("ObjectName")
                ?? throw new Exception("sky StaticMesh has no ObjectName")),
            ["material"] = ReferenceName(
                RequiredArray(componentProperties, "OverrideMaterials")
                    .Single()
                    .Value<string>("ObjectName")
                ?? throw new Exception(
                    "sky OverrideMaterials entry has no ObjectName")),
            ["RelativeScale3D"] = VectorXYZ(
                RequiredObject(componentProperties, "RelativeScale3D")),
            ["CastShadow"] = RequiredBool(componentProperties, "CastShadow"),
            ["CollisionEnabled"] = RequiredString(
                RequiredObject(componentProperties, "BodyInstance"),
                "CollisionEnabled"),
            ["ShadingModel"] = RequiredString(
                materialProperties,
                "ShadingModel"),
            ["TwoSided"] = RequiredBool(materialProperties, "TwoSided"),
            ["bIsSky"] = RequiredBool(materialProperties, "bIsSky"),
            ["EmissiveExpression"] = ReferenceName(
                RequiredObject(emissive, "Expression")
                    .Value<string>("ObjectName")
                ?? throw new Exception(
                    "sky material Emissive expression has no ObjectName")),
            ["ColorParameter"] = new JObject
            {
                ["name"] = RequiredString(
                    parameterProperties,
                    "ParameterName"),
                ["value"] = RequiredObject(
                    parameterProperties,
                    "DefaultValue"),
            },
        };
    }

    static JObject NormalizeSkyLight(
        JObject actor,
        JObject component,
        UObject textureExport)
    {
        var componentProperties = Properties(component);
        var textureProperties = Properties(Serialize(textureExport));
        var source = RequiredObject(textureProperties, "Source");
        // L_Als_Grid does not serialize either lower-hemisphere property, so the effective values
        // come from USkyLightComponent's constructor: enabled and FLinearColor::Black. Freeze the
        // inherited engine defaults here instead of silently treating the cubemap as omnidirectional.
        var lowerHemisphereIsBlack =
            componentProperties["bLowerHemisphereIsBlack"]?.Value<bool>()
            ?? true;
        var lowerHemisphereColor =
            componentProperties["LowerHemisphereColor"] as JObject
            ?? new JObject
            {
                ["R"] = 0.0,
                ["G"] = 0.0,
                ["B"] = 0.0,
                ["A"] = 1.0,
            };
        var colorInfo = RequiredArray(source, "LayerColorInfo_LockProtected")
                            .Single() as JObject
                        ?? throw new Exception(
                            "LayerColorInfo_LockProtected entry is not an object");
        return new JObject
        {
            ["actorLabel"] = RequiredString(Properties(actor), "ActorLabel"),
            ["SourceType"] = RequiredString(componentProperties, "SourceType"),
            ["Cubemap"] = ReferenceName(
                RequiredObject(componentProperties, "Cubemap")
                    .Value<string>("ObjectName")
                ?? throw new Exception("skylight Cubemap has no ObjectName")),
            ["Intensity"] = RequiredNumber(componentProperties, "Intensity"),
            ["bLowerHemisphereIsBlack"] = lowerHemisphereIsBlack,
            ["LowerHemisphereColor"] = lowerHemisphereColor,
            ["cubemapSource"] = new JObject
            {
                ["SizeX"] = RequiredNumber(source, "SizeX"),
                ["SizeY"] = RequiredNumber(source, "SizeY"),
                ["NumSlices"] = RequiredNumber(source, "NumSlices"),
                ["Format"] = RequiredString(source, "Format"),
                ["ColorMin"] = RequiredObject(colorInfo, "ColorMin"),
                ["ColorMax"] = RequiredObject(colorInfo, "ColorMax"),
            },
        };
    }

    static JObject NormalizeScalarParameters(IEnumerable<UObject> exports)
    {
        var parameters = new JObject();
        foreach (var export in exports
                     .Where(
                         export =>
                             export.ExportType
                             == "MaterialExpressionScalarParameter")
                     .OrderBy(export => export.Name, StringComparer.Ordinal))
        {
            var properties = Properties(Serialize(export));
            parameters[RequiredString(properties, "ParameterName")] =
                RequiredNumber(properties, "DefaultValue");
        }
        return parameters;
    }

    static JArray NormalizeExpressions(IEnumerable<UObject> exports)
    {
        var expressions = new JArray();
        foreach (var export in exports
                     .Where(
                         export =>
                             export.ExportType.StartsWith(
                                 "MaterialExpression",
                                 StringComparison.Ordinal))
                     .OrderBy(export => export.Name, StringComparer.Ordinal))
        {
            var serialized = Serialize(export);
            var properties = Properties(serialized);
            var expression = new JObject
            {
                ["name"] = export.Name,
                ["type"] = export.ExportType,
            };
            var inputs = new JObject();
            foreach (var inputName in new[] { "Input", "A", "B", "Base", "Exponent" })
            {
                if (properties[inputName] is not JObject input
                    || input["Expression"] is not JObject inputExpression
                    || inputExpression.Value<string>("ObjectName") is not string objectName)
                {
                    continue;
                }
                inputs[inputName] = ReferenceName(objectName);
            }
            if (inputs.Count > 0)
                expression["inputs"] = inputs;

            var values = new JObject();
            foreach (var valueName in new[]
                     {
                         "ConstA", "ConstB", "ConstExponent", "Bias", "Scale",
                         "R", "G", "B", "A", "ParameterName", "DefaultValue",
                         "Name",
                     })
            {
                if (properties[valueName] is JValue value)
                    values[valueName] = value.DeepClone();
            }
            if (values.Count > 0)
                expression["values"] = values;

            if (properties["Declaration"] is JObject declaration
                && declaration.Value<string>("ObjectName") is string declarationName)
            {
                expression["declaration"] = ReferenceName(declarationName);
            }
            expressions.Add(expression);
        }
        return expressions;
    }

    static JArray ValidatePayload(JObject payload)
    {
        var validations = new JArray();
        AddValidation(
            validations,
            "schema-version",
            payload.Value<int>("schemaVersion") == 1);
        AddValidation(
            validations,
            "five-external-actors",
            (payload.SelectToken("source.externalActorAssetPaths") as JArray)
                ?.Count == 5);
        AddValidation(
            validations,
            "no-precomputed-lighting",
            payload.SelectToken("world.bForceNoPrecomputedLighting")
                ?.Value<bool>() == true);
        AddValidation(
            validations,
            "unbound-post-process",
            payload.SelectToken("postProcess.bUnbound")?.Value<bool>() == true);
        AddValidation(
            validations,
            "fixed-exposure",
            NumberAt(
                payload,
                "postProcess.settings.AutoExposureMinBrightness") == 1
            && NumberAt(
                payload,
                "postProcess.settings.AutoExposureMaxBrightness") == 1
            && NumberAt(payload, "postProcess.settings.AutoExposureBias") == 0);
        AddValidation(
            validations,
            "vignette-and-motion-blur",
            NearlyEqual(
                NumberAt(payload, "postProcess.settings.VignetteIntensity"),
                0.85)
            && NearlyEqual(
                NumberAt(payload, "postProcess.settings.MotionBlurAmount"),
                0));
        AddValidation(
            validations,
            "one-kilometer-floor",
            NumberAt(payload, "floor.boundsExtentCm.X") == 50000
            && NumberAt(payload, "floor.boundsExtentCm.Y") == 50000);
        AddValidation(
            validations,
            "authored-grid-material",
            payload.SelectToken("gridMaterial.BlendMode")?.Value<string>()
                == "BLEND_Translucent"
            && payload.SelectToken("gridMaterial.ShadingModel")?.Value<string>()
                == "MSM_Unlit"
            && payload.SelectToken("gridMaterial.TwoSided")?.Value<bool>() == true
            && NearlyEqual(
                NumberAt(payload, "gridMaterial.parameters.CellWidth"),
                75)
            && NearlyEqual(
                NumberAt(payload, "gridMaterial.parameters.FadeOffset"),
                1000)
            && NearlyEqual(
                NumberAt(payload, "gridMaterial.parameters.FadeLength"),
                2000)
            && NearlyEqual(
                NumberAt(payload, "gridMaterial.parameters.FadeExponent"),
                5)
            && NearlyEqual(
                NumberAt(payload, "gridMaterial.parameters.LineWidthExponent"),
                100)
            && NearlyEqual(
                NumberAt(
                    payload,
                    "gridMaterial.parameters.LineWidthMultiplier"),
                1.075)
            && (payload.SelectToken("gridMaterial.expressions") as JArray)?.Count
            == 32);
        AddValidation(
            validations,
            "grid-material-expression-graph",
            payload.SelectToken("gridMaterial.OpacityExpression")
                ?.Value<string>() == "MaterialExpressionMultiply_4"
            && InputIs(
                payload,
                "MaterialExpressionSubtract_1",
                "A",
                "MaterialExpressionWorldPosition_1")
            && InputIs(
                payload,
                "MaterialExpressionSubtract_1",
                "B",
                "MaterialExpressionObjectPositionWS_1")
            && InputIs(
                payload,
                "MaterialExpressionDivide_0",
                "A",
                "MaterialExpressionSubtract_1")
            && InputIs(
                payload,
                "MaterialExpressionDivide_0",
                "B",
                "MaterialExpressionScalarParameter_8")
            && InputIs(
                payload,
                "MaterialExpressionPower_5",
                "Base",
                "MaterialExpressionMultiply_6")
            && InputIs(
                payload,
                "MaterialExpressionPower_5",
                "Exponent",
                "MaterialExpressionScalarParameter_7")
            && InputIs(
                payload,
                "MaterialExpressionDistance_0",
                "A",
                "MaterialExpressionWorldPosition_2")
            && InputIs(
                payload,
                "MaterialExpressionDistance_0",
                "B",
                "MaterialExpressionCameraPositionWS_2")
            && InputIs(
                payload,
                "MaterialExpressionDivide_4",
                "A",
                "MaterialExpressionSubtract_5")
            && InputIs(
                payload,
                "MaterialExpressionDivide_4",
                "B",
                "MaterialExpressionScalarParameter_2")
            && InputIs(
                payload,
                "MaterialExpressionPower_2",
                "Base",
                "MaterialExpressionOneMinus_3")
            && InputIs(
                payload,
                "MaterialExpressionPower_2",
                "Exponent",
                "MaterialExpressionScalarParameter_5")
            && InputIs(
                payload,
                "MaterialExpressionMultiply_4",
                "A",
                "MaterialExpressionNamedRerouteUsage_1")
            && InputIs(
                payload,
                "MaterialExpressionMultiply_4",
                "B",
                "MaterialExpressionNamedRerouteUsage_0"));
        AddValidation(
            validations,
            "authored-sky-sphere",
            payload.SelectToken("skySphere.mesh")?.Value<string>() == "Sphere"
            && NumberAt(payload, "skySphere.RelativeScale3D.X") == 1000
            && NearlyEqual(
                NumberAt(payload, "skySphere.ColorParameter.value.R"),
                0)
            && NearlyEqual(
                NumberAt(payload, "skySphere.ColorParameter.value.G"),
                0.333333)
            && NearlyEqual(
                NumberAt(payload, "skySphere.ColorParameter.value.B"),
                2));
        AddValidation(
            validations,
            "white-hdri-skylight",
            NumberAt(payload, "skyLight.Intensity") == 2
            && payload.SelectToken("skyLight.bLowerHemisphereIsBlack")
                ?.Value<bool>() == true
            && NumberAt(payload, "skyLight.LowerHemisphereColor.R") == 0
            && NumberAt(payload, "skyLight.LowerHemisphereColor.G") == 0
            && NumberAt(payload, "skyLight.LowerHemisphereColor.B") == 0
            && NumberAt(payload, "skyLight.cubemapSource.NumSlices") == 6
            && NumberAt(payload, "skyLight.cubemapSource.ColorMin.R") == 1
            && NumberAt(payload, "skyLight.cubemapSource.ColorMin.G") == 1
            && NumberAt(payload, "skyLight.cubemapSource.ColorMin.B") == 1
            && NumberAt(payload, "skyLight.cubemapSource.ColorMax.R") == 1
            && NumberAt(payload, "skyLight.cubemapSource.ColorMax.G") == 1
            && NumberAt(payload, "skyLight.cubemapSource.ColorMax.B") == 1);
        return validations;
    }

    static (string AssetPath, UObject[] Exports) LoadPackageExports(
        DefaultFileProvider provider,
        string assetName,
        string extension,
        string contentPath)
    {
        var file = provider.Files.Values.SingleOrDefault(
                       candidate =>
                           candidate.NameWithoutExtension == assetName
                           && candidate.Extension == extension
                           && NormalizePath(candidate.Path).Contains(
                               contentPath,
                               StringComparison.Ordinal))
                   ?? throw new Exception(
                       $"{assetName}.{extension} was not found exactly once below " +
                       contentPath);
        return (file.Path, provider.LoadPackage(file).GetExports().ToArray());
    }

    static UObject SameNamedExport(
        IEnumerable<UObject> exports,
        string assetName)
    {
        return exports.SingleOrDefault(export => export.Name == assetName)
               ?? throw new Exception($"{assetName} has no same-named export");
    }

    static JObject SingleExport(IEnumerable<JObject> exports, string type)
    {
        return exports.SingleOrDefault(
                   export => export.Value<string>("Type") == type)
               ?? throw new Exception($"expected exactly one {type} export");
    }

    static JObject SingleActor(
        IEnumerable<JObject> exports,
        string type,
        string actorLabel)
    {
        return exports.SingleOrDefault(
                   export =>
                       export.Value<string>("Type") == type
                       && export.SelectToken("Properties.ActorLabel")
                           ?.Value<string>() == actorLabel)
               ?? throw new Exception(
                   $"expected exactly one {type} actor labeled {actorLabel}");
    }

    static JObject ComponentForActor(
        IEnumerable<JObject> exports,
        JObject actor,
        string componentType)
    {
        var actorName = actor.Value<string>("Name")
                        ?? throw new Exception("actor has no Name");
        return exports.SingleOrDefault(
                   export =>
                       export.Value<string>("Type") == componentType
                       && export.SelectToken("Outer.ObjectName")
                           ?.Value<string>()
                           ?.Contains(
                               $".{actorName}'",
                               StringComparison.Ordinal) == true)
               ?? throw new Exception(
                   $"{actorName} has no {componentType} export");
    }

    static JObject Serialize(UObject export)
    {
        return JObject.FromObject(export, Serializer);
    }

    static JObject Properties(JObject export)
    {
        return export["Properties"] as JObject
               ?? throw new Exception(
                   $"{export.Value<string>("Name") ?? "export"} has no Properties");
    }

    static JObject RequiredObject(JObject parent, string name)
    {
        return parent[name] as JObject
               ?? throw new Exception($"{name} is not an object");
    }

    static JArray RequiredArray(JObject parent, string name)
    {
        return parent[name] as JArray
               ?? throw new Exception($"{name} is not an array");
    }

    static string RequiredString(JObject parent, string name)
    {
        return parent.Value<string>(name)
               ?? throw new Exception($"{name} is not a string");
    }

    static bool RequiredBool(JObject parent, string name)
    {
        return parent[name]?.Value<bool>()
               ?? throw new Exception($"{name} is not a bool");
    }

    static double RequiredNumber(JObject parent, string name)
    {
        return parent[name]?.Value<double>()
               ?? throw new Exception($"{name} is not a number");
    }

    static JObject VectorXYZ(JObject vector)
    {
        return new JObject
        {
            ["X"] = RequiredNumber(vector, "X"),
            ["Y"] = RequiredNumber(vector, "Y"),
            ["Z"] = RequiredNumber(vector, "Z"),
        };
    }

    static string ReferenceName(string objectName)
    {
        var firstQuote = objectName.IndexOf('\'');
        var lastQuote = objectName.LastIndexOf('\'');
        var reference = firstQuote >= 0 && lastQuote > firstQuote
            ? objectName[(firstQuote + 1)..lastQuote]
            : objectName;
        var separator = Math.Max(
            reference.LastIndexOf('.'),
            reference.LastIndexOf(':'));
        return separator >= 0 ? reference[(separator + 1)..] : reference;
    }

    static string NormalizePath(string path)
    {
        return "/" + path.Replace('\\', '/').TrimStart('/');
    }

    static double? NumberAt(JObject payload, string path)
    {
        return payload.SelectToken(path)?.Value<double>();
    }

    static bool NearlyEqual(double? value, double expected)
    {
        return value is double actual && Math.Abs(actual - expected) <= 1e-6;
    }

    static bool InputIs(
        JObject payload,
        string expressionName,
        string inputName,
        string expectedSource)
    {
        var expression = (
                payload.SelectToken("gridMaterial.expressions") as JArray)
            ?.OfType<JObject>()
            .SingleOrDefault(
                candidate =>
                    candidate.Value<string>("name") == expressionName);
        return expression?.SelectToken($"inputs.{inputName}")
            ?.Value<string>() == expectedSource;
    }

    static void AddValidation(
        JArray validations,
        string name,
        bool passed)
    {
        validations.Add(
            new JObject
            {
                ["name"] = name,
                ["passed"] = passed,
            });
    }

    static void PrintValidations(JArray validations)
    {
        foreach (var validation in validations.OfType<JObject>())
        {
            Console.WriteLine(
                $"{(validation.Value<bool>("passed") ? "PASS" : "FAIL")} " +
                validation.Value<string>("name"));
        }
    }

    static void ThrowOnValidationFailure(JArray validations)
    {
        var failures = validations
            .OfType<JObject>()
            .Where(validation => !validation.Value<bool>("passed"))
            .Select(
                validation =>
                    validation.Value<string>("name") ?? "unnamed validation")
            .ToArray();
        if (failures.Length > 0)
            throw new Exception(
                "L_Als_Grid validation failed: " +
                string.Join(", ", failures));
    }
}
