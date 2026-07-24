using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Extracts IMC_Als_Default plus the InputAction trigger/modifier objects that
// define the actual control contract (notably Hold Sprint vs Tap Roll).
public static class InputMappingDump
{
    const string MappingContextName = "IMC_Als_Default";

    static readonly string[] ExpectedActions =
    [
        "IA_Als_Aim",
        "IA_Als_Crouch",
        "IA_Als_Jump",
        "IA_Als_Look",
        "IA_Als_LookMouse",
        "IA_Als_Move",
        "IA_Als_Ragdoll",
        "IA_Als_Roll",
        "IA_Als_RotationMode",
        "IA_Als_Sprint",
        "IA_Als_SwitchShoulder",
        "IA_Als_ViewMode",
        "IA_Als_Walk",
    ];

    static readonly (string Action, string Key)[] ExpectedMappings =
    [
        ("IA_Als_LookMouse", "Mouse2D"),
        ("IA_Als_Look", "Up"),
        ("IA_Als_Look", "Left"),
        ("IA_Als_Look", "Down"),
        ("IA_Als_Look", "Right"),
        ("IA_Als_Look", "Gamepad_Right2D"),
        ("IA_Als_Move", "W"),
        ("IA_Als_Move", "A"),
        ("IA_Als_Move", "S"),
        ("IA_Als_Move", "D"),
        ("IA_Als_Move", "Gamepad_Left2D"),
        ("IA_Als_Sprint", "LeftShift"),
        ("IA_Als_Sprint", "Gamepad_FaceButton_Right"),
        ("IA_Als_Walk", "LeftAlt"),
        ("IA_Als_Walk", "Gamepad_RightShoulder"),
        ("IA_Als_Crouch", "LeftControl"),
        ("IA_Als_Crouch", "Gamepad_LeftThumbstick"),
        ("IA_Als_Jump", "SpaceBar"),
        ("IA_Als_Jump", "Gamepad_FaceButton_Bottom"),
        ("IA_Als_Aim", "RightMouseButton"),
        ("IA_Als_Aim", "Gamepad_LeftShoulder"),
        ("IA_Als_Ragdoll", "X"),
        ("IA_Als_Ragdoll", "Gamepad_FaceButton_Left"),
        ("IA_Als_Roll", "LeftShift"),
        ("IA_Als_Roll", "Gamepad_FaceButton_Right"),
        ("IA_Als_RotationMode", "One"),
        ("IA_Als_RotationMode", "Gamepad_DPad_Left"),
        ("IA_Als_ViewMode", "Two"),
        ("IA_Als_ViewMode", "Gamepad_DPad_Right"),
        ("IA_Als_SwitchShoulder", "C"),
        ("IA_Als_SwitchShoulder", "Gamepad_RightThumbstick"),
    ];

    static readonly JsonSerializer Serializer = JsonSerializer.Create(
        new JsonSerializerSettings
        {
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
        });

    public static int Run(string srcDir, string outJson)
    {
        var provider = CreateProvider(srcDir);
        var contextExports = LoadExports(provider, MappingContextName);
        var context = contextExports.Single(export => export.Name == MappingContextName);
        var contextProperties = Properties(context);
        var modifierExports = contextExports.ToDictionary(export => export.Name);
        var mappings = new JArray(
            (contextProperties["Mappings"] as JArray ?? [])
            .OfType<JObject>()
            .Select(mapping => DumpMapping(mapping, modifierExports)));

        var actions = new JObject();
        foreach (var actionName in ExpectedActions)
        {
            var exports = LoadExports(provider, actionName);
            var action = exports.Single(export => export.Name == actionName);
            var innerExports = exports.ToDictionary(export => export.Name);
            var properties = Properties(action);
            actions[actionName] = new JObject
            {
                ["assetPath"] = $"/ALS/ALS/Data/Input/{actionName}",
                ["valueType"] =
                    properties.Value<string>("ValueType") ?? "EInputActionValueType::Boolean",
                ["consumeInput"] = properties.Value<bool?>("bConsumeInput") ?? true,
                ["triggers"] = DumpObjectReferences(
                    properties["Triggers"] as JArray,
                    innerExports),
                ["modifiers"] = DumpObjectReferences(
                    properties["Modifiers"] as JArray,
                    innerExports),
            };
        }

        var payload = new JObject
        {
            ["schemaVersion"] = 1,
            ["source"] = new JObject
            {
                ["release"] = "ALS-Refactored 4.15",
                ["engineVersion"] = "UE5.5",
                ["asset"] = "/ALS/ALS/Data/Input/IMC_Als_Default",
            },
            ["mappingContext"] = new JObject
            {
                ["name"] = MappingContextName,
                ["mappings"] = mappings,
            },
            ["actions"] = actions,
            ["inventory"] = new JObject
            {
                ["mappingModifiers"] = Inventory(
                    mappings.Values<JObject>()
                        .SelectMany(mapping => mapping!["modifiers"]?.Values<JObject>() ?? [])
                        .Select(modifier => modifier!.Value<string>("type"))),
                ["actionModifiers"] = Inventory(
                    actions.Properties()
                        .SelectMany(action => action.Value["modifiers"]?.Values<JObject>() ?? [])
                        .Select(modifier => modifier!.Value<string>("type"))),
                ["actionTriggers"] = Inventory(
                    actions.Properties()
                        .SelectMany(action => action.Value["triggers"]?.Values<JObject>() ?? [])
                        .Select(trigger => trigger!.Value<string>("type"))),
            },
            ["unrecoverable"] = new JArray
            {
                "Unreal omits class-default-valued tagged properties. Empty serializedProperties " +
                "on modifier/trigger subobjects therefore means the ALS asset uses that UE5.5 " +
                "Enhanced Input class default; the extractor does not invent a duplicate value.",
            },
        };
        payload["validations"] = ValidatePayload(payload);

        Directory.CreateDirectory(
            Path.GetDirectoryName(Path.GetFullPath(outJson))
            ?? throw new Exception($"invalid output path {outJson}"));
        File.WriteAllText(outJson, payload.ToString(Formatting.Indented) + "\n");
        ThrowOnValidationFailure(payload["validations"]!);
        Console.WriteLine(
            $"dumped {mappings.Count} mappings and {actions.Count} actions -> {outJson}");
        return 0;
    }

    public static int Validate(string inputJson)
    {
        var payload = JObject.Parse(File.ReadAllText(inputJson));
        var validations = ValidatePayload(payload);
        ThrowOnValidationFailure(validations);
        Console.WriteLine($"validated {inputJson}");
        return 0;
    }

    static JObject DumpMapping(
        JObject mapping,
        IReadOnlyDictionary<string, UObject> innerExports)
    {
        return new JObject
        {
            ["action"] = AssetReference(mapping["Action"]),
            ["key"] = mapping.SelectToken("Key.KeyName")?.Value<string>(),
            ["triggers"] = DumpObjectReferences(
                mapping["Triggers"] as JArray,
                innerExports),
            ["modifiers"] = DumpObjectReferences(
                mapping["Modifiers"] as JArray,
                innerExports),
            ["playerMappable"] = mapping.Value<bool?>("bIsPlayerMappable") ?? false,
        };
    }

    static JArray DumpObjectReferences(
        JArray? references,
        IReadOnlyDictionary<string, UObject> innerExports)
    {
        var result = new JArray();
        foreach (var reference in references?.OfType<JObject>() ?? [])
        {
            var assetReference = AssetReference(reference);
            var name = assetReference.Value<string>("name")
                       ?? throw new Exception("input object reference has no name");
            var separator = name.LastIndexOf(':');
            var exportName = separator >= 0 ? name[(separator + 1)..] : name;
            if (!innerExports.TryGetValue(exportName, out var export))
                throw new Exception($"input subobject {exportName} was not exported");
            result.Add(
                new JObject
                {
                    ["type"] = export.ExportType,
                    ["name"] = export.Name,
                    ["serializedProperties"] = PropertiesOrEmpty(export),
                });
        }
        return result;
    }

    static JObject AssetReference(JToken? token)
    {
        if (token is not JObject obj)
            throw new Exception("missing input asset reference");
        var objectName = obj.Value<string>("ObjectName") ?? "";
        var firstQuote = objectName.IndexOf('\'');
        var lastQuote = objectName.LastIndexOf('\'');
        var name = firstQuote >= 0 && lastQuote > firstQuote
            ? objectName[(firstQuote + 1)..lastQuote]
            : objectName;
        return new JObject
        {
            ["name"] = name,
            ["objectPath"] = obj.Value<string>("ObjectPath"),
        };
    }

    static JObject Properties(UObject export) =>
        JObject.FromObject(export, Serializer)["Properties"] as JObject
        ?? throw new Exception($"{export.Name} has no serialized Properties");

    static JObject PropertiesOrEmpty(UObject export) =>
        JObject.FromObject(export, Serializer)["Properties"] as JObject
        ?? new JObject();

    static JObject ValidatePayload(JObject payload)
    {
        var errors = new JArray();
        var actions = payload["actions"] as JObject ?? new JObject();
        var actualActionNames = actions.Properties().Select(property => property.Name).ToArray();
        foreach (var name in ExpectedActions.Except(actualActionNames))
            errors.Add($"missing InputAction {name}");
        foreach (var name in actualActionNames.Except(ExpectedActions))
            errors.Add($"unexpected InputAction {name}");

        var mappings = payload.SelectToken("mappingContext.mappings") as JArray ?? [];
        var actualMappings = mappings.OfType<JObject>()
            .Select(
                mapping => (
                    mapping.SelectToken("action.name")?.Value<string>() ?? "",
                    mapping.Value<string>("key") ?? ""))
            .ToArray();
        if (!actualMappings.SequenceEqual(ExpectedMappings))
            errors.Add(
                "mapping action/key order differs: " +
                string.Join(", ", actualMappings.Select(mapping => $"{mapping.Item1}:{mapping.Item2}")));

        var sprintTriggers = actions["IA_Als_Sprint"]?["triggers"] as JArray ?? [];
        if (sprintTriggers.Count != 2
            || sprintTriggers[0]?["type"]?.Value<string>() != "InputTriggerHold"
            || !NearlyEqual(
                sprintTriggers[0]?.SelectToken("serializedProperties.HoldTimeThreshold")
                    ?.Value<double>(),
                0.1)
            || sprintTriggers[0]?.SelectToken("serializedProperties.bIsOneShot")
                   ?.Value<bool>() != true
            || sprintTriggers[1]?["type"]?.Value<string>() != "InputTriggerReleased")
            errors.Add("IA_Als_Sprint Hold(0.1s, one-shot)+Released contract changed");

        var rollTriggers = actions["IA_Als_Roll"]?["triggers"] as JArray ?? [];
        if (rollTriggers.Count != 1
            || rollTriggers[0]?["type"]?.Value<string>() != "InputTriggerTap"
            || !NearlyEqual(
                rollTriggers[0]?.SelectToken("serializedProperties.TapReleaseTimeThreshold")
                    ?.Value<double>(),
                0.3))
            errors.Add("IA_Als_Roll Tap(0.3s) contract changed");

        var moveGamepad = mappings.OfType<JObject>().SingleOrDefault(
            mapping =>
                mapping.SelectToken("action.name")?.Value<string>() == "IA_Als_Move"
                && mapping.Value<string>("key") == "Gamepad_Left2D");
        var lookGamepad = mappings.OfType<JObject>().SingleOrDefault(
            mapping =>
                mapping.SelectToken("action.name")?.Value<string>() == "IA_Als_Look"
                && mapping.Value<string>("key") == "Gamepad_Right2D");
        if (moveGamepad?["modifiers"]?.Values<JObject>()
                .Select(modifier => modifier!.Value<string>("type"))
                .SingleOrDefault() != "InputModifierDeadZone")
            errors.Add("IA_Als_Move Gamepad_Left2D default DeadZone modifier changed");
        if (!(lookGamepad?["modifiers"]?.Values<JObject>()
                  .Select(modifier => modifier!.Value<string>("type"))
                  .SequenceEqual(["InputModifierNegate", "InputModifierDeadZone"])
              ?? false))
            errors.Add("IA_Als_Look Gamepad_Right2D Negate+DeadZone order changed");

        var expectedInventory = new JObject
        {
            ["mappingModifiers"] = new JObject
            {
                ["InputModifierDeadZone"] = 2,
                ["InputModifierNegate"] = 5,
                ["InputModifierSwizzleAxis"] = 4,
            },
            ["actionModifiers"] = new JObject
            {
                ["InputModifierScaleByDeltaTime"] = 1,
            },
            ["actionTriggers"] = new JObject
            {
                ["InputTriggerHold"] = 1,
                ["InputTriggerPressed"] = 8,
                ["InputTriggerReleased"] = 3,
                ["InputTriggerTap"] = 1,
            },
        };
        if (!JToken.DeepEquals(payload["inventory"], expectedInventory))
            errors.Add(
                "input modifier/trigger inventory differs: " +
                payload["inventory"]?.ToString(Formatting.None));

        return new JObject
        {
            ["id"] = "als-4.15-input-mapping-content",
            ["passed"] = errors.Count == 0,
            ["details"] = new JObject
            {
                ["expectedActionCount"] = ExpectedActions.Length,
                ["actualActionCount"] = actions.Count,
                ["expectedMappingCount"] = ExpectedMappings.Length,
                ["actualMappingCount"] = mappings.Count,
                ["errors"] = errors,
            },
        };
    }

    static bool NearlyEqual(double? actual, double expected) =>
        actual is not null && Math.Abs(actual.Value - expected) <= 1e-6;

    static JObject Inventory(IEnumerable<string?> types) =>
        new(
            types.Where(type => !string.IsNullOrWhiteSpace(type))
                .GroupBy(type => type!, StringComparer.Ordinal)
                .OrderBy(group => group.Key, StringComparer.Ordinal)
                .Select(group => new JProperty(group.Key, group.Count())));

    static void ThrowOnValidationFailure(JToken validations)
    {
        foreach (var validation in validations is JArray array
                     ? array.OfType<JObject>()
                     : [validations as JObject ?? new JObject()])
        {
            var passed = validation.Value<bool>("passed");
            Console.WriteLine(
                $"{(passed ? "PASS" : "FAIL")} {validation.Value<string>("id")}");
            if (!passed)
                throw new Exception(validation["details"]?.ToString(Formatting.None));
        }
    }

    static UObject[] LoadExports(DefaultFileProvider provider, string assetName)
    {
        var file = provider.Files.Values.SingleOrDefault(
                       candidate =>
                           candidate.NameWithoutExtension == assetName &&
                           candidate.Extension == "uasset")
                   ?? throw new Exception($"{assetName}.uasset not found");
        return provider.LoadPackage(file).GetExports().ToArray();
    }

    static DefaultFileProvider CreateProvider(string srcDir)
    {
        var provider = new DefaultFileProvider(
            srcDir,
            SearchOption.AllDirectories,
            new VersionContainer(EGame.GAME_UE5_5));
        provider.Initialize();
        provider.Mount();
        return provider;
    }
}
