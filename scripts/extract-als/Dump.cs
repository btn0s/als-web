// Stage 1 of the ALS extraction chain: CUE4Parse → JSON.
//
// Uncooked (editor-saved) .uassets carry no cooked render/compressed data, so the
// stock CUE4Parse-Conversion exporters can't run. What uncooked assets DO carry,
// as plain tagged properties, is the full editor source: the skeleton's reference
// pose (USkeleton.ReferenceSkeleton) and every animation's AnimDataModel with raw
// per-bone key tracks. This stage dumps exactly that to JSON; assemble-glb.mjs
// (stage 2) does additive composition, axis/unit conversion, and GLB writing.
//
// Mesh geometry is NOT here: SKM_Als's editor geometry lives in native bulk data
// (SkeletalMeshEditorData) that CUE4Parse doesn't deserialize — parsing it is the
// scheduled M2 follow-up; until then stage 2 builds a bone-proxy body.
//
// Usage: dotnet run -- dump <stage-dir> <out.json> <AnimName> [AnimName...]

using System.Text.Json;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Animation;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Assets.Objects.Properties;
using CUE4Parse.UE4.Versions;

public static class Dump
{
    public static int Run(string srcDir, string outJson, string[] animNames)
    {
        var provider = new DefaultFileProvider(srcDir, SearchOption.AllDirectories, new VersionContainer(EGame.GAME_UE5_5));
        provider.Initialize();
        provider.Mount();

        var skelFile = provider.Files.Values.First(f => f.NameWithoutExtension == "SK_Als" && f.Extension == "uasset");
        var skel = provider.LoadPackage(skelFile).GetExports().OfType<USkeleton>().First();
        var refSkel = skel.ReferenceSkeleton;
        var bones = refSkel.FinalRefBoneInfo.Select((b, i) => new
        {
            name = b.Name.Text,
            parent = b.ParentIndex,
            // UE native space (cm, Z-up); stage 2 converts.
            t = V(refSkel.FinalRefBonePose[i].Translation),
            r = Q(refSkel.FinalRefBonePose[i].Rotation),
            s = V(refSkel.FinalRefBonePose[i].Scale3D),
        }).ToArray();

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

            anims.Add(new
            {
                name = animName,
                additiveType = seq.AdditiveAnimType.ToString(),
                refPoseSeq = seq.RefPoseSeq?.Name ?? "",
                refFrameIndex = seq.RefFrameIndex,
                fps = (double)frameRate.GetOrDefault("Numerator", 30) / Math.Max(1, frameRate.GetOrDefault("Denominator", 1)),
                numberOfKeys = model.Get<int>("NumberOfKeys"),
                tracks,
            });
        }

        var payload = new { skeleton = new { bones }, anims };
        File.WriteAllText(outJson, JsonSerializer.Serialize(payload));
        Console.WriteLine($"dumped {bones.Length} bones, {anims.Count} anims -> {outJson}");
        return 0;
    }

    static float[] V(CUE4Parse.UE4.Objects.Core.Math.FVector v) => [v.X, v.Y, v.Z];
    static float[] Q(CUE4Parse.UE4.Objects.Core.Math.FQuat q) => [q.X, q.Y, q.Z, q.W];
}
