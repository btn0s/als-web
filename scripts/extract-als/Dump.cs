// Stage 1 of the ALS extraction chain: CUE4Parse → JSON.
//
// Uncooked (editor-saved) .uassets carry no cooked render/compressed data, so the
// stock CUE4Parse-Conversion exporters can't run. What uncooked assets DO carry
// is the full editor source: skeleton reference poses, skeletal-mesh editor LOD0,
// and every animation's AnimDataModel with raw per-bone key tracks. This stage
// dumps that source to JSON; assemble-glb.mjs (stage 2) handles basis/unit
// conversion and GLB writing.
//
// Usage: dotnet run -- dump <stage-dir> <out.json> <SkeletonName> <MeshName>
//                          <MaterialInstanceName> [AnimName...]

using System.Text.Json;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Animation;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Assets.Objects.Properties;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Versions;

public static class Dump
{
    public static int Run(
        string srcDir,
        string outJson,
        string skeletonName,
        string meshName,
        string materialInstanceName,
        string[] animNames)
    {
        ObjectTypeRegistry.RegisterClass("SkeletalMesh", typeof(UAlsSkeletalMesh));
        var provider = new DefaultFileProvider(srcDir, SearchOption.AllDirectories, new VersionContainer(EGame.GAME_UE5_5));
        provider.Initialize();
        provider.Mount();

        var skelFile = provider.Files.Values.First(
            f => f.NameWithoutExtension == skeletonName && f.Extension == "uasset");
        var skel = provider.LoadPackage(skelFile).GetExports().OfType<USkeleton>().First();
        var refSkel = skel.ReferenceSkeleton;
        var meshFile = provider.Files.Values.First(
            f => f.NameWithoutExtension == meshName && f.Extension == "uasset");
        var meshPackage = provider.LoadPackage(meshFile);
        var skeletalMesh = meshPackage.GetExports().OfType<UAlsSkeletalMesh>().First();
        if (skeletalMesh.ParseError is not null)
            throw new Exception(
                $"failed to parse {meshName} editor LOD0",
                skeletalMesh.ParseError);
        var bones = refSkel.FinalRefBoneInfo.Select((b, i) => new
        {
            name = b.Name.Text,
            parent = b.ParentIndex,
            // UE native space (cm, Z-up); stage 2 converts.
            t = V(refSkel.FinalRefBonePose[i].Translation),
            r = Q(refSkel.FinalRefBonePose[i].Rotation),
            s = V(refSkel.FinalRefBonePose[i].Scale3D),
        }).ToArray();

        var lod0 = skeletalMesh.LODModels[0];
        var materialNames = skeletalMesh.SkeletalMaterials
            .Select((material, index) =>
                string.IsNullOrWhiteSpace(material.MaterialSlotName.Text)
                    ? $"Material_{index}"
                    : material.MaterialSlotName.Text)
            .ToArray();
        var meshSections = lod0.Sections.Select((section, sectionIndex) =>
        {
            if (section.MaterialIndex < 0 || section.MaterialIndex >= materialNames.Length)
                throw new Exception(
                    $"section {sectionIndex} references material {section.MaterialIndex}, " +
                    $"but the mesh has {materialNames.Length} slots");
            var sectionIndices = lod0.Indices
                .Skip(section.BaseIndex)
                .Take(section.NumTriangles * 3)
                .Select(index => checked((int)((long)index - section.BaseVertexIndex)))
                .ToArray();
            if (sectionIndices.Any(index => index < 0 || index >= section.SoftVertices.Length))
                throw new Exception(
                    $"section {sectionIndex} has indices outside its {section.SoftVertices.Length} local vertices");

            return new
            {
                materialIndex = (int)section.MaterialIndex,
                materialName = materialNames[section.MaterialIndex],
                maxBoneInfluences = section.MaxBoneInfluences,
                boneMap = section.BoneMap.Select(index => (int)index).ToArray(),
                positions = section.SoftVertices.Select(vertex => V(vertex.Position)).ToArray(),
                normals = section.SoftVertices
                    .Select(vertex => new[] { vertex.Normal.X, vertex.Normal.Y, vertex.Normal.Z })
                    .ToArray(),
                uv0 = section.SoftVertices.Select(vertex => new[] { vertex.UV0.U, vertex.UV0.V }).ToArray(),
                joints = section.SoftVertices
                    .Select(vertex => vertex.BoneIndices.Select(index => (int)index).ToArray())
                    .ToArray(),
                weights = section.SoftVertices
                    .Select(vertex => vertex.BoneWeights.Select(weight => (int)weight).ToArray())
                    .ToArray(),
                indices = sectionIndices,
            };
        }).ToArray();
        var allMeshVertices = lod0.Sections.SelectMany(section => section.SoftVertices).ToArray();
        var weightSums = allMeshVertices.Select(vertex => vertex.BoneWeights.Sum(weight => (int)weight)).ToArray();
        var influenceCounts = allMeshVertices
            .Select(vertex => vertex.BoneWeights.Count(weight => weight > 0))
            .ToArray();
        var expectedWeightSum = weightSums.Max() > byte.MaxValue
            ? ushort.MaxValue
            : byte.MaxValue;
        // The rifle's 16-bit source weights retain up to seven units of
        // quantization drift around 65535; stage 2 normalizes selected weights.
        if (weightSums.Any(sum => Math.Abs(sum - expectedWeightSum) > 16))
            throw new Exception(
                $"skin weights are not normalized: min={weightSums.Min()}, max={weightSums.Max()}");

        var materialFile = provider.Files.Values.First(
            f => f.NameWithoutExtension == materialInstanceName && f.Extension == "uasset");
        var materialInstance = provider.LoadPackage(materialFile).GetExports()
            .First(export => export.Name == materialInstanceName);
        var baseColor = FindVectorParameter(materialInstance, "Color");

        var anims = new List<object>();
        foreach (var animName in animNames)
        {
            var file = provider.Files.Values.FirstOrDefault(f => f.NameWithoutExtension == animName && f.Extension == "uasset")
                       ?? throw new Exception($"{animName}.uasset not found");
            var pkg = provider.LoadPackage(file);
            var seq = pkg.GetExports().OfType<UAnimSequence>().First();
            var model = pkg.GetExports().First(e => e.ExportType == "AnimDataModel");

            var frameRate = model.Get<FStructFallback>("FrameRate");
            var tracksArr = model.Get<UScriptArray>("BoneAnimationTracks");
            var tracks = new List<object>();
            foreach (var el in tracksArr.Properties)
            {
                var st = (FStructFallback)((StructProperty)el).Value!.StructType;
                var raw = (FRawAnimSequenceTrack)((StructProperty)st.Properties.First(p => p.Name.Text == "InternalTrackData").Tag!).Value!.StructType;
                tracks.Add(new
                {
                    bone = st.Properties.First(p => p.Name.Text == "Name").Tag!.GenericValue!.ToString(),
                    pos = raw.PosKeys?.Select(V).ToArray() ?? [],
                    rot = raw.RotKeys?.Select(Q).ToArray() ?? [],
                    scale = raw.ScaleKeys?.Select(V).ToArray() ?? [],
                });
            }

            var curves = new List<object>();
            var curveData = model.GetOrDefault<FStructFallback?>("CurveData");
            if (curveData is not null)
            {
                var rawCurves = new FRawCurveTracks(curveData);
                foreach (var curve in rawCurves.FloatCurves ?? [])
                {
                    curves.Add(new
                    {
                        name = curve.CurveName.Text,
                        flags = curve.CurveTypeFlags,
                        keys = curve.FloatCurve.Keys
                            .Select(key => new object[] { key.Time, key.Value, (int)key.InterpMode })
                            .ToArray(),
                    });
                }
            }

            anims.Add(new
            {
                name = animName,
                additiveType = seq.AdditiveAnimType.ToString(),
                refPoseSeq = seq.RefPoseSeq?.Name ?? "",
                refFrameIndex = seq.RefFrameIndex,
                fps = (double)frameRate.GetOrDefault("Numerator", 30) / Math.Max(1, frameRate.GetOrDefault("Denominator", 1)),
                numberOfKeys = model.Get<int>("NumberOfKeys"),
                tracks,
                curves,
            });
        }

        var payload = new
        {
            skeleton = new { name = skeletonName, bones },
            mesh = new
            {
                name = meshName,
                lod = 0,
                numVertices = lod0.NumVertices,
                numTriangles = lod0.Sections.Sum(section => section.NumTriangles),
                materialNames,
                maxInfluences = influenceCounts.Max(),
                verticesOverFourInfluences = influenceCounts.Count(count => count > 4),
                sections = meshSections,
            },
            material = new
            {
                source = materialInstanceName,
                baseColor = new[] { baseColor.R, baseColor.G, baseColor.B, baseColor.A },
            },
            anims,
        };
        File.WriteAllText(outJson, JsonSerializer.Serialize(payload));
        Console.WriteLine(
            $"mesh LOD0: {lod0.NumVertices} vertices, {lod0.Sections.Sum(section => section.NumTriangles)} triangles, " +
            $"{lod0.Sections.Length} sections, max {influenceCounts.Max()} influences, " +
            $"{influenceCounts.Count(count => count > 4)} vertices over four");
        Console.WriteLine(
            $"material: {materialInstanceName} Color=" +
            $"[{baseColor.R:0.###}, {baseColor.G:0.###}, {baseColor.B:0.###}, {baseColor.A:0.###}]");
        Console.WriteLine(
            $"dumped {skeletonName}: {bones.Length} bones, {anims.Count} anims -> {outJson}");
        return 0;
    }

    static FLinearColor FindVectorParameter(UObject materialInstance, string parameterName)
    {
        var parameters = materialInstance.Get<UScriptArray>("VectorParameterValues");
        foreach (var element in parameters.Properties)
        {
            var parameter = (FStructFallback)((StructProperty)element).Value!.StructType;
            var infoProperty = parameter.Properties.First(property => property.Name.Text == "ParameterInfo");
            var info = (FStructFallback)((StructProperty)infoProperty.Tag!).Value!.StructType;
            var name = info.Properties.First(property => property.Name.Text == "Name")
                .Tag!.GenericValue!.ToString();
            if (name != parameterName) continue;

            var valueProperty = parameter.Properties.First(property => property.Name.Text == "ParameterValue");
            return (FLinearColor)((StructProperty)valueProperty.Tag!).Value!.StructType;
        }

        throw new Exception(
            $"{materialInstance.Name} has no {parameterName} vector parameter");
    }

    static float[] V(CUE4Parse.UE4.Objects.Core.Math.FVector v) => [v.X, v.Y, v.Z];
    static float[] Q(CUE4Parse.UE4.Objects.Core.Math.FQuat q) => [q.X, q.Y, q.Z, q.W];
}
