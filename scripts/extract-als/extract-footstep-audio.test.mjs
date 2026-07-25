import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeEmbeddedWave, uewavDecode16Mono } from './extract-footstep-audio.mjs';

const wrapInt16 = (value) => {
  const unsigned = value & 0xffff;
  return unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
};

const uewavEncode16Mono = (samples) => {
  const transformed = Buffer.alloc(samples.length * 2);
  let previousSample = 0;

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const signedCode = sampleIndex === 0
      ? sample
      : wrapInt16(sample - previousSample + 128);
    const unsignedCode = signedCode & 0xffff;
    transformed[sampleIndex] = unsignedCode & 0xff;
    transformed[samples.length + sampleIndex] = unsignedCode >>> 8;
    previousSample = sample;
  }

  return transformed;
};

const fixture = (samples) => {
  const data = uewavEncode16Mono(samples);
  const list = Buffer.from('LIST\x04\0\0\0INFO', 'binary');
  const riff = Buffer.alloc(44 + data.length + list.length);
  riff.write('RIFF'); riff.writeUInt32LE(riff.length - 8, 4); riff.write('WAVE', 8);
  riff.write('fmt ', 12); riff.writeUInt32LE(16, 16); riff.writeUInt16LE(0xffff, 20);
  riff.writeUInt16LE(1, 22); riff.writeUInt32LE(48000, 24); riff.writeUInt32LE(96000, 28);
  riff.writeUInt16LE(2, 32); riff.writeUInt16LE(16, 34); riff.write('data', 36); riff.writeUInt32LE(data.length, 40);
  data.copy(riff, 44); list.copy(riff, 44 + data.length);
  return Buffer.concat([Buffer.from('UEPKG'), riff, Buffer.alloc(20)]);
};

const readPcm16 = (bytes) => {
  const samples = [];
  for (let offset = 0; offset < bytes.length; offset += 2) {
    samples.push(bytes.readInt16LE(offset));
  }
  return samples;
};

test('reverses UEWavComp byte planes and biased deltas before marking the RIFF as PCM', () => {
  const samples = [5, -56, -133, 32760, -32760, 0, 128, -128, 1234];
  const source = fixture(samples);
  const sourceList = source.subarray(source.length - 32, source.length - 20);
  const { wave, metadata } = decodeEmbeddedWave(source, 'fixture');
  assert.equal(metadata.riffOffset, 5);
  assert.equal(metadata.trailingAssetBytes, 20);
  assert.equal(metadata.sourceFormatTag, 0xffff);
  assert.equal(metadata.decodedFormatTag, 1);
  assert.equal(metadata.sourceEncoding, 'UEWavComp 16-bit mono byte-plane delta');
  assert.equal(metadata.sampleCount, samples.length);
  assert.equal(wave.readUInt16LE(20), 1);
  assert.equal(wave.readUInt32LE(40), samples.length * 2);
  assert.deepEqual(readPcm16(wave.subarray(
    metadata.dataOffset,
    metadata.dataOffset + metadata.dataBytes,
  )), samples);
  assert.deepEqual(wave.subarray(wave.length - 12), sourceList);
  assert.deepEqual(metadata.chunks, [
    { id: 'fmt ', bytes: 16 },
    { id: 'data', bytes: samples.length * 2 },
    { id: 'LIST', bytes: 4 },
  ]);
});

test('rejects malformed UEWavComp sample planes', () => {
  assert.throws(
    () => uewavDecode16Mono(Buffer.from([1, 2, 3]), 'fixture'),
    /non-empty even number of bytes/,
  );
});
