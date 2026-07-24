using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Animation;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Assets.Readers;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.Engine;
using CUE4Parse.UE4.Objects.Meshes;
using CUE4Parse.UE4.Objects.RenderCore;

// SKM_Als's UE 5.5 editor serialization differs from CUE4Parse 1.2.2.202607 at
// four seams: an extra model strip-flags field; 12 bone indices (uint8 or uint16,
// according to the serialized bUse16BitBoneIndex) plus 12 uint8 weights per soft
// vertex; the 49-byte FSkelMeshSourceSectionUserData map; and a plain uint32
// index array followed by a retained legacy vertex-count field. Keep this asset
// compatibility shim at the extraction seam rather than patching the vendored
// library.
public sealed class UAlsSkeletalMesh : UObject
{
    public FBoxSphereBounds ImportedBounds { get; private set; } = null!;
    public FSkeletalMaterial[] SkeletalMaterials { get; private set; } = [];
    public FReferenceSkeleton ReferenceSkeleton { get; private set; } = null!;
    public AlsLodModel[] LODModels { get; private set; } = [];
    public Exception? ParseError { get; private set; }

    public override void Deserialize(FAssetArchive ar, long validPos)
    {
        base.Deserialize(ar, validPos);

        try
        {
            _ = new FStripDataFlags(ar);
            ImportedBounds = new FBoxSphereBounds(ar);
            SkeletalMaterials = ar.ReadArray(() => new FSkeletalMaterial(ar));
            ReferenceSkeleton = new FReferenceSkeleton(ar);

            _ = new FStripDataFlags(ar);
            var lodCount = ar.Read<int>();
            if (lodCount is < 1 or > 16)
                throw new Exception($"implausible inline skeletal mesh LOD count {lodCount} at {ar.Position - 4}");

            // Only LOD0 ships. Parsing it also validates the editor format against
            // every section before the export loader skips the unused trailing data.
            LODModels = [new AlsLodModel(ar)];
        }
        catch (Exception exception)
        {
            ParseError = exception;
        }
        finally
        {
            ar.Position = validPos;
        }
    }
}

public sealed class AlsLodModel
{
    public AlsMeshSection[] Sections { get; }
    public uint[] Indices { get; }
    public short[] ActiveBoneIndices { get; }
    public int Size { get; }
    public int NumVertices { get; }
    public short[] RequiredBones { get; }
    public int NumTexCoords { get; }

    public AlsLodModel(FAssetArchive ar)
    {
        var stripDataFlags = new FStripDataFlags(ar);
        Sections = ar.ReadArray(() => new AlsMeshSection(ar));
        var userSectionCount = ar.Read<int>();
        if (userSectionCount != Sections.Length)
            throw new Exception(
                $"LOD user-section mismatch: map={userSectionCount}, sections={Sections.Length}");
        ar.Position += userSectionCount * 49L; // TMap<int32, FSkelMeshSourceSectionUserData>
        Indices = ar.ReadArray<uint>();
        ActiveBoneIndices = ar.ReadArray<short>();
        Size = ar.Read<int>();
        _ = ar.Read<int>(); // legacy NumVertices field retained by this editor serialization
        if (!stripDataFlags.IsAudioVisualDataStripped()) NumVertices = ar.Read<int>();
        RequiredBones = ar.ReadArray<short>();
        if (!stripDataFlags.IsEditorDataStripped()) _ = new FIntBulkData(ar);
        MeshToImportVertexMap = ar.ReadArray<int>();
        MaxImportVertex = ar.Read<int>();
        if (!stripDataFlags.IsAudioVisualDataStripped()) NumTexCoords = ar.Read<int>();

        if (Sections.Sum(section => section.NumVertices) != NumVertices)
            throw new Exception(
                $"LOD vertex mismatch: sections={Sections.Sum(section => section.NumVertices)}, model={NumVertices}");
        if (Sections.Sum(section => section.NumTriangles) * 3 != Indices.Length)
            throw new Exception(
                $"LOD index mismatch: sections need {Sections.Sum(section => section.NumTriangles) * 3}, " +
                $"buffer has {Indices.Length}");
    }

    // Parsed only to maintain the native serialization cursor.
    int[] MeshToImportVertexMap { get; }
    int MaxImportVertex { get; }
}

public sealed class AlsMeshSection
{
    public short MaterialIndex { get; }
    public int BaseIndex { get; }
    public int NumTriangles { get; }
    public uint BaseVertexIndex { get; }
    public AlsSoftVertex[] SoftVertices { get; }
    public bool Use16BitBoneIndex { get; }
    public ushort[] BoneMap { get; }
    public int NumVertices { get; }
    public int MaxBoneInfluences { get; }

    public AlsMeshSection(FAssetArchive ar)
    {
        var stripDataFlags = new FStripDataFlags(ar);
        MaterialIndex = ar.Read<short>();
        if (!stripDataFlags.IsAudioVisualDataStripped())
        {
            BaseIndex = ar.Read<int>();
            NumTriangles = ar.Read<int>();
        }

        _ = ar.ReadBoolean(); // bRecomputeTangent
        _ = ar.Read<byte>(); // RecomputeTangentsVertexMaskChannel
        _ = ar.ReadBoolean(); // bCastShadow
        _ = ar.ReadBoolean(); // bVisibleInRayTracing

        if (!stripDataFlags.IsAudioVisualDataStripped()) BaseVertexIndex = ar.Read<uint>();
        bool parsed16BitBoneIndices;
        bool parsed16BitBoneWeights;
        int parsedInfluenceCount;
        int parsedUvCount;
        if (!stripDataFlags.IsEditorDataStripped() && !ar.IsFilterEditorOnly)
        {
            var vertexCount = ar.Read<int>();
            var vertexDataStart = ar.Position;
            (
                parsed16BitBoneIndices,
                parsed16BitBoneWeights,
                parsedInfluenceCount,
                parsedUvCount
            ) =
                ProbeInfluenceLayout(ar, vertexDataStart, vertexCount);
            ar.Position = vertexDataStart;
            SoftVertices = Enumerable.Range(0, vertexCount)
                .Select(_ => new AlsSoftVertex(
                    ar,
                    parsed16BitBoneIndices,
                    parsed16BitBoneWeights,
                    parsedInfluenceCount,
                    parsedUvCount))
                .ToArray();
        }
        else
        {
            SoftVertices = [];
            parsed16BitBoneIndices = false;
            parsed16BitBoneWeights = false;
            parsedInfluenceCount = 0;
            parsedUvCount = 0;
        }

        Use16BitBoneIndex = ar.ReadBoolean();
        BoneMap = ar.ReadArray<ushort>();
        NumVertices = ar.Read<int>();
        MaxBoneInfluences = ar.Read<int>();

        // AddClothMappingLODBias format: nested cloth-mapping arrays.
        var clothLodCount = ar.Read<int>();
        for (var i = 0; i < clothLodCount; i++)
            _ = ar.ReadArray(() => new FMeshToMeshVertData(ar));

        _ = ar.Read<short>(); // CorrespondClothAssetIndex
        _ = ar.Read<FClothingSectionData>();

        var overlappingVertexCount = ar.Read<int>();
        for (var i = 0; i < overlappingVertexCount; i++)
        {
            _ = ar.Read<int>();
            _ = ar.ReadArray<int>();
        }

        _ = ar.ReadBoolean(); // bDisabled
        _ = ar.Read<int>(); // GenerateUpToLodIndex
        _ = ar.Read<int>(); // OriginalDataSectionIndex
        _ = ar.Read<int>(); // ChunkedParentSectionIndex

        if (SoftVertices.Length != NumVertices)
            throw new Exception(
                $"section {MaterialIndex} vertex mismatch: array={SoftVertices.Length}, field={NumVertices}");
        if (BoneMap.Length == 0 && NumVertices > 0)
            throw new Exception($"section {MaterialIndex} has vertices but no BoneMap");
    }

    static (
        bool Use16BitBoneIndices,
        bool Use16BitBoneWeights,
        int InfluenceCount,
        int UvCount
    ) ProbeInfluenceLayout(
        FAssetArchive ar,
        long dataStart,
        int vertexCount)
    {
        // Position, three tangents, and color occupy 56 bytes around 1–4 UV
        // channels. UE assets in the repository carry 4–24 reserved
        // influence slots and uint8/uint16 indices. Probe those layouts, then
        // independently require the following render flag, BoneMap, NumVertices,
        // and MaxBoneInfluences fields to agree with the candidate. The render
        // bUse16BitBoneIndex flag does not describe the editor soft-vertex array:
        // both meshes store uint16 editor indices even when that flag is false.
        const int BytesWithoutUvsOrInfluences = 56;
        // The editor soft-vertex struct reserves four UV channels even when the
        // mesh reports fewer active channels; prefer that full layout when byte
        // counts are otherwise ambiguous with additional influence slots.
        foreach (var uvCount in new[] { 4, 3, 2, 1 })
        {
            foreach (var influenceCount in new[] { 4, 8, 12, 16, 24 })
            {
                foreach (var candidate16Bit in new[] { false, true })
                {
                    foreach (var candidate16BitWeights in new[] { false, true })
                    {
                        var bytesPerIndex = candidate16Bit ? 2 : 1;
                        var bytesPerWeight = candidate16BitWeights ? 2 : 1;
                        var bytesPerVertex =
                            BytesWithoutUvsOrInfluences +
                            uvCount * 8 +
                            influenceCount * bytesPerIndex +
                            influenceCount * bytesPerWeight;
                        ar.Position = dataStart + (long)vertexCount * bytesPerVertex;
                        var serializedFlag = ar.Read<int>();
                        var boneMapCount = ar.Read<int>();
                        if (serializedFlag is not (0 or 1) ||
                            boneMapCount is <= 0 or >= 4096)
                            continue;

                        ar.Position += boneMapCount * sizeof(ushort);
                        var serializedVertexCount = ar.Read<int>();
                        var maxBoneInfluences = ar.Read<int>();
                        if (serializedVertexCount == vertexCount &&
                            maxBoneInfluences is > 0 &&
                            maxBoneInfluences <= influenceCount)
                            return (
                                candidate16Bit,
                                candidate16BitWeights,
                                influenceCount,
                                uvCount
                            );
                    }
                }
            }
        }

        var matchingStrides = new List<int>();
        for (var bytesPerVertex = 56; bytesPerVertex <= 192; bytesPerVertex++)
        {
            ar.Position = dataStart + (long)vertexCount * bytesPerVertex;
            var serializedFlag = ar.Read<int>();
            var boneMapCount = ar.Read<int>();
            if (serializedFlag is not (0 or 1) ||
                boneMapCount is <= 0 or >= 4096)
                continue;
            ar.Position += boneMapCount * sizeof(ushort);
            if (ar.Read<int>() == vertexCount)
                matchingStrides.Add(bytesPerVertex);
        }

        throw new Exception(
            $"could not determine influence layout for {vertexCount} soft vertices at {dataStart}; " +
            $"post-field matching strides=[{string.Join(", ", matchingStrides)}]");
    }

    public sealed class AlsSoftVertex
    {
        public FVector Position { get; }
        public FPackedNormal Normal { get; }
        public FMeshUVFloat UV0 { get; }
        public FColor Color { get; }
        public ushort[] BoneIndices { get; }
        public ushort[] BoneWeights { get; }

        public AlsSoftVertex(
            FAssetArchive ar,
            bool use16BitBoneIndex,
            bool use16BitBoneWeight,
            int influenceCount,
            int uvCount)
        {
            Position = ar.Read<FVector>();
            _ = ar.Read<FVector>(); // tangent X
            _ = ar.Read<FVector>(); // tangent Y
            Normal = new FPackedNormal(ar.Read<FVector4>()); // tangent Z

            UV0 = ar.Read<FMeshUVFloat>();
            for (var i = 1; i < uvCount; i++) _ = ar.Read<FMeshUVFloat>();
            Color = ar.Read<FColor>();

            BoneIndices = use16BitBoneIndex
                ? ar.ReadArray<ushort>(influenceCount)
                : ar.ReadArray<byte>(influenceCount).Select(index => (ushort)index).ToArray();
            BoneWeights = use16BitBoneWeight
                ? ar.ReadArray<ushort>(influenceCount)
                : ar.ReadArray<byte>(influenceCount).Select(weight => (ushort)weight).ToArray();
        }
    }
}
