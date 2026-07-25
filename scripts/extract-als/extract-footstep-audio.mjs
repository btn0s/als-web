#!/usr/bin/env node
// Extracts ALS's editor-source RIFF tails without interpreting UE package data.
// UE 5.4+ stores their PCM payloads through UEWavComp: signed delta samples are
// byte-deplaned so the surrounding bulk-data compressor sees long zero runs.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export const WAVES = [
  'S_Als_Footstep_Concrete_Step_01',
  'S_Als_Footstep_Concrete_Step_02',
  'S_Als_Footstep_Concrete_Step_03',
  'S_Als_Footstep_Concrete_Walk_01',
  'S_Als_Footstep_Concrete_Walk_02',
  'S_Als_Footstep_Concrete_Walk_03',
  'S_Als_Footstep_Concrete_Walk_04',
  'S_Als_Footstep_Concrete_Walk_05',
];
// Frozen after comparing every decoded stream to the same ALS assets immediately
// before UEWavComp was enabled (4.13): correlation 0.999946–0.999997.
const DECODED_DATA_SHA256 = {
  S_Als_Footstep_Concrete_Step_01: '387fb6c5112777200dd442d5c5135c9b999d2a6f6dacc0b6968767fe550ebdac',
  S_Als_Footstep_Concrete_Step_02: 'bc3dc2d068ce5cf08d1eea468489ba313666b397594018ec1c103d86ba354729',
  S_Als_Footstep_Concrete_Step_03: '2850af056c6442785275d63585b95f7ed0007a942bc966bd3edae5c4758807aa',
  S_Als_Footstep_Concrete_Walk_01: '9b0fd3dfb120fd14212c2ceaf2a0ca8ed6e87e70813cbf307ed3bcd41adc7108',
  S_Als_Footstep_Concrete_Walk_02: '113cc146289fc7387d24459c01c3addff24774e49c598d24df8b75fdca66dc82',
  S_Als_Footstep_Concrete_Walk_03: '7268041f90a1d4676068c1816d6dbe33a04ab561392e9d99b0c994b569550624',
  S_Als_Footstep_Concrete_Walk_04: '9d8b54c70e5a1cd3ae423fd416fca6f1e9edeaf53ddded629615c4b3bf3c81a4',
  S_Als_Footstep_Concrete_Walk_05: '29c17ae882abed8f357fe746c0d17ffa1a2e9c85e6638374c556dc0e422e01ab',
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => { throw new Error(`footstep audio: ${message}`); };
const u16 = (bytes, offset) => bytes.readUInt16LE(offset);
const u32 = (bytes, offset) => bytes.readUInt32LE(offset);
const wrapInt16 = (value) => {
  const unsigned = value & 0xffff;
  return unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
};

// Mono specialization of Unreal's uewav_decode16(). The first sample is stored
// literally. Every later code is a signed delta biased by +128. All low bytes
// precede all high bytes in the transformed payload.
export const uewavDecode16Mono = (transformed, label = 'UEWavComp payload') => {
  if (transformed.length === 0 || transformed.length % 2 !== 0) {
    fail(`${label} must contain a non-empty even number of bytes`);
  }

  const sampleCount = transformed.length / 2;
  const decoded = Buffer.allocUnsafe(transformed.length);
  let previousSample = 0;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const unsignedCode = transformed[sampleIndex]
      | (transformed[sampleCount + sampleIndex] << 8);
    const signedCode = wrapInt16(unsignedCode);
    const sample = sampleIndex === 0
      ? signedCode
      : wrapInt16(previousSample + signedCode - 128);
    decoded.writeInt16LE(sample, sampleIndex * 2);
    previousSample = sample;
  }

  return decoded;
};

export const decodeEmbeddedWave = (asset, label = 'asset') => {
  const riffOffset = asset.indexOf(Buffer.from('RIFF'));
  if (riffOffset < 0 || asset.indexOf(Buffer.from('RIFF'), riffOffset + 1) >= 0) fail(`${label} must contain exactly one RIFF`);
  if (asset.subarray(riffOffset + 8, riffOffset + 12).toString('ascii') !== 'WAVE') fail(`${label} RIFF is not WAVE`);
  const riffBytes = u32(asset, riffOffset + 4) + 8;
  const riffEnd = riffOffset + riffBytes;
  if (riffEnd !== asset.length - 20) fail(`${label} RIFF end ${riffEnd} must equal file size - 20 (${asset.length - 20})`);
  const wave = Buffer.from(asset.subarray(riffOffset, riffEnd));
  if (wave.subarray(12, 16).toString('ascii') !== 'fmt ' || u32(wave, 16) !== 16) fail(`${label} must have a 16-byte fmt chunk`);
  const formatTag = u16(wave, 20);
  const channels = u16(wave, 22);
  const sampleRate = u32(wave, 24);
  const byteRate = u32(wave, 28);
  const blockAlign = u16(wave, 32);
  const bitsPerSample = u16(wave, 34);
  if (formatTag !== 0xffff || channels !== 1 || sampleRate !== 48000 || byteRate !== 96000 || blockAlign !== 2 || bitsPerSample !== 16) fail(`${label} fmt invariants drifted`);
  let cursor = 12;
  let dataBytes;
  let dataOffset;
  const chunks = [];
  while (cursor < wave.length) {
    if (cursor + 8 > wave.length) fail(`${label} has truncated RIFF chunk header`);
    const id = wave.subarray(cursor, cursor + 4).toString('ascii');
    const bytes = u32(wave, cursor + 4);
    const end = cursor + 8 + bytes + (bytes % 2);
    if (end > wave.length) fail(`${label} ${id} chunk exceeds RIFF bounds`);
    chunks.push({ id, bytes });
    if (id === 'data') {
      if (dataBytes !== undefined) fail(`${label} must contain exactly one data chunk`);
      dataBytes = bytes;
      dataOffset = cursor + 8;
    }
    cursor = end;
  }
  if (cursor !== wave.length || dataBytes === undefined || dataBytes % blockAlign !== 0) fail(`${label} data chunk bounds/alignment drifted`);
  const sourceSha256 = sha256(wave);
  const sourceData = wave.subarray(dataOffset, dataOffset + dataBytes);
  const sourceDataSha256 = sha256(sourceData);
  const decodedData = uewavDecode16Mono(sourceData, label);
  decodedData.copy(wave, dataOffset);
  wave.writeUInt16LE(1, 20);
  return {
    wave,
    metadata: {
      sourceFileBytes: asset.length,
      riffOffset,
      riffBytes,
      trailingAssetBytes: asset.length - riffEnd,
      sourceFormatTag: formatTag,
      decodedFormatTag: 1,
      sourceEncoding: 'UEWavComp 16-bit mono byte-plane delta',
      decodedEncoding: 'PCM signed 16-bit little-endian',
      channels,
      sampleRate,
      byteRate,
      blockAlign,
      bitsPerSample,
      sampleCount: dataBytes / blockAlign,
      dataOffset,
      dataBytes,
      chunks,
      sourceDataSha256,
      decodedDataSha256: sha256(decodedData),
      sourceSha256,
      sha256: sha256(wave),
    },
  };
};

export const extract = async (alsRoot, outputDirectory, metadataPath) => {
  const sourceDirectory = join(alsRoot, 'Content/ALS/Audio/Footsteps');
  await mkdir(outputDirectory, { recursive: true });
  const waves = [];
  for (const name of WAVES) {
    const asset = await readFile(join(sourceDirectory, `${name}.uasset`));
    const { wave, metadata } = decodeEmbeddedWave(asset, name);
    if (metadata.decodedDataSha256 !== DECODED_DATA_SHA256[name]) {
      fail(`${name} decoded PCM oracle drifted`);
    }
    const output = `${name}.wav`;
    await writeFile(join(outputDirectory, output), wave);
    waves.push({ name, sourceAsset: `Content/ALS/Audio/Footsteps/${name}.uasset`, output, ...metadata });
  }
  const payload = { schemaVersion: 2, format: 'PCM signed 16-bit little-endian', waves };
  await writeFile(metadataPath, `${JSON.stringify(payload, null, 2)}\n`);
  await validate(outputDirectory, metadataPath);
  console.log(`extracted ${waves.length} ALS footstep WAVs -> ${outputDirectory}`);
};

export const validate = async (outputDirectory, metadataPath) => {
  const payload = JSON.parse(await readFile(metadataPath, 'utf8'));
  if (payload.schemaVersion !== 2 || payload.waves?.length !== WAVES.length) fail('metadata schema/wave count drifted');
  for (const item of payload.waves) {
    if (!WAVES.includes(item.name)
      || item.decodedFormatTag !== 1
      || item.sourceFormatTag !== 0xffff
      || item.sourceEncoding !== 'UEWavComp 16-bit mono byte-plane delta'
      || item.decodedEncoding !== payload.format
      || item.decodedDataSha256 !== DECODED_DATA_SHA256[item.name]) {
      fail(`metadata invariants drifted for ${item.name}`);
    }
    const wave = await readFile(join(outputDirectory, item.output));
    const decodedData = wave.subarray(item.dataOffset, item.dataOffset + item.dataBytes);
    if (u16(wave, 20) !== 1
      || sha256(decodedData) !== item.decodedDataSha256
      || sha256(wave) !== item.sha256
      || wave.length !== item.riffBytes) {
      fail(`output validation failed for ${item.name}`);
    }
  }
  console.log(`validated ${basename(metadataPath)}`);
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'extract' && args.length === 3) await extract(...args);
  else if (command === 'validate' && args.length === 2) await validate(...args);
  else fail('usage: extract-footstep-audio.mjs extract <als-root> <output-dir> <metadata.json> | validate <output-dir> <metadata.json>');
}
