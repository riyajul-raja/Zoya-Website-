export const OFFICIAL_ZOYA_PACKAGE = 'com.riyajul.zoya';

export interface ClientApkMetadata {
  packageName: string;
  versionName: string;
  versionCode: number;
  minSdkVersion: number | null;
  targetSdkVersion: number | null;
  minAndroidVersion: string;
  targetAndroidVersion: string | null;
  fileSize: number;
  fileSizeFormatted: string;
  sha256: string;
  fileName: string;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatAndroidSdk(sdkVersion: number | null | undefined, isMin = true): string {
  if (!sdkVersion || isNaN(sdkVersion) || sdkVersion <= 0) {
    return isMin ? 'Not specified in APK' : 'Not specified';
  }
  const sdkMap: Record<number, string> = {
    21: 'Android 5.0',
    22: 'Android 5.1',
    23: 'Android 6.0',
    24: 'Android 7.0',
    25: 'Android 7.1',
    26: 'Android 8.0',
    27: 'Android 8.1',
    28: 'Android 9.0',
    29: 'Android 10.0',
    30: 'Android 11.0',
    31: 'Android 12.0',
    32: 'Android 12L',
    33: 'Android 13.0',
    34: 'Android 14.0',
    35: 'Android 15.0',
  };
  const base = sdkMap[sdkVersion] || 'Android';
  return isMin ? `${base} (API ${sdkVersion})+` : `${base} (API ${sdkVersion})`;
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(compressed as unknown as BufferSource);
    writer.close();
    const response = new Response(ds.readable);
    const ab = await response.arrayBuffer();
    return new Uint8Array(ab);
  }
  throw new Error('Browser does not support DecompressionStream for deflate-raw.');
}

async function extractAndroidManifestFromZip(bytes: Uint8Array): Promise<Uint8Array> {
  if (
    bytes.length < 22 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw new Error('Invalid APK file: File is not a valid Android Package (ZIP header missing).');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const utf8Decoder = new TextDecoder('utf-8');

  // 1. Locate End of Central Directory (EOCD) record (0x06054b50)
  const maxCommentLength = 65535;
  const searchStart = Math.max(0, bytes.length - 22 - maxCommentLength);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= searchStart; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const cdSize = view.getUint32(eocdOffset + 12, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);

    if (cdOffset + cdSize <= bytes.length) {
      let ptr = cdOffset;
      const cdEnd = cdOffset + cdSize;
      while (ptr + 46 <= cdEnd) {
        const sig = view.getUint32(ptr, true);
        if (sig !== 0x02014b45) break;

        const compressionMethod = view.getUint16(ptr + 10, true);
        const compressedSize = view.getUint32(ptr + 20, true);
        const fileNameLen = view.getUint16(ptr + 28, true);
        const extraLen = view.getUint16(ptr + 30, true);
        const commentLen = view.getUint16(ptr + 32, true);
        const localHeaderOffset = view.getUint32(ptr + 42, true);

        const nameStart = ptr + 46;
        if (nameStart + fileNameLen > bytes.length) break;
        const entryName = utf8Decoder.decode(bytes.subarray(nameStart, nameStart + fileNameLen));

        if (entryName === 'AndroidManifest.xml') {
          if (localHeaderOffset + 30 > bytes.length) {
            throw new Error('Corrupted APK: Invalid local header offset for AndroidManifest.xml.');
          }
          const localSig = view.getUint32(localHeaderOffset, true);
          if (localSig !== 0x04034b50) {
            throw new Error('Corrupted APK: Invalid local file header signature for AndroidManifest.xml.');
          }
          const localNameLen = view.getUint16(localHeaderOffset + 26, true);
          const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
          const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
          const dataEnd = dataStart + compressedSize;

          if (dataEnd > bytes.length) {
            throw new Error('Corrupted APK: AndroidManifest.xml data extends beyond file boundary.');
          }

          const rawSlice = bytes.subarray(dataStart, dataEnd);
          if (compressionMethod === 0) return rawSlice;
          if (compressionMethod === 8) return await inflateRawBytes(rawSlice);
          throw new Error(`Unsupported ZIP compression method (${compressionMethod}) for AndroidManifest.xml.`);
        }

        ptr = nameStart + fileNameLen + extraLen + commentLen;
      }
    }
  }

  // 2. Fallback: Scan Local File Headers sequentially
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;

    if (nameStart + fileNameLen > bytes.length) break;
    const entryName = utf8Decoder.decode(bytes.subarray(nameStart, nameStart + fileNameLen));
    const dataStart = nameStart + fileNameLen + extraLen;
    const dataEnd = dataStart + compressedSize;

    if (entryName === 'AndroidManifest.xml') {
      if (dataEnd > bytes.length || compressedSize === 0) {
        throw new Error('Invalid APK: Cannot read AndroidManifest.xml payload.');
      }
      const rawSlice = bytes.subarray(dataStart, dataEnd);
      if (compressionMethod === 0) return rawSlice;
      if (compressionMethod === 8) return await inflateRawBytes(rawSlice);
      throw new Error(`Unsupported compression method (${compressionMethod}) for AndroidManifest.xml.`);
    }

    if (compressedSize === 0) break;
    offset = dataEnd;
  }

  throw new Error('Invalid APK file: AndroidManifest.xml was not found inside the archive.');
}

function parseBinaryAndroidManifest(axml: Uint8Array) {
  if (axml.length < 8) {
    throw new Error('Invalid AndroidManifest.xml: File is too small.');
  }

  const view = new DataView(axml.buffer, axml.byteOffset, axml.byteLength);
  const xmlChunkType = view.getUint16(0, true);
  const xmlHeaderSize = view.getUint16(2, true);
  if (xmlChunkType !== 0x0003) {
    throw new Error('Invalid AndroidManifest.xml: Not in compiled Android Binary XML (AXML) format.');
  }

  const utf8Decoder = new TextDecoder('utf-8');
  const utf16Decoder = new TextDecoder('utf-16le');

  let strings: string[] = [];
  let resourceIds: number[] = [];

  let packageName = '';
  let versionName = '';
  let versionCode = 0;
  let versionCodeMajor = 0;
  let minSdkVersion: number | null = null;
  let targetSdkVersion: number | null = null;

  let offset = xmlHeaderSize;
  while (offset + 8 <= axml.length) {
    const chunkType = view.getUint16(offset, true);
    const headerSize = view.getUint16(offset + 2, true);
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkSize < 8 || offset + chunkSize > axml.length) {
      break;
    }

    if (chunkType === 0x0001) {
      const stringCount = view.getUint32(offset + 8, true);
      const flags = view.getUint32(offset + 16, true);
      const stringsStart = view.getUint32(offset + 20, true);
      const isUtf8 = (flags & 0x0100) !== 0;

      const offsetsBase = offset + headerSize;
      const poolDataBase = offset + stringsStart;
      strings = new Array(stringCount);

      for (let i = 0; i < stringCount; i++) {
        if (offsetsBase + (i + 1) * 4 > offset + chunkSize) {
          strings[i] = '';
          continue;
        }
        const strOffset = poolDataBase + view.getUint32(offsetsBase + i * 4, true);
        if (strOffset >= offset + chunkSize) {
          strings[i] = '';
          continue;
        }

        if (isUtf8) {
          let p = strOffset;
          const u16Len = axml[p++];
          if ((u16Len & 0x80) !== 0) p++;
          let u8Len = axml[p++];
          if ((u8Len & 0x80) !== 0) {
            u8Len = ((u8Len & 0x7f) << 8) | axml[p++];
          }
          strings[i] = utf8Decoder.decode(axml.subarray(p, Math.min(p + u8Len, offset + chunkSize)));
        } else {
          let p = strOffset;
          let u16Len = view.getUint16(p, true);
          p += 2;
          if ((u16Len & 0x8000) !== 0) {
            u16Len = ((u16Len & 0x7fff) << 16) | view.getUint16(p, true);
            p += 2;
          }
          const byteLen = u16Len * 2;
          strings[i] = utf16Decoder.decode(axml.subarray(p, Math.min(p + byteLen, offset + chunkSize)));
        }
      }
    } else if (chunkType === 0x0180) {
      const count = Math.floor((chunkSize - headerSize) / 4);
      resourceIds = new Array(count);
      for (let i = 0; i < count; i++) {
        resourceIds[i] = view.getUint32(offset + headerSize + i * 4, true);
      }
    } else if (chunkType === 0x0102) {
      const nameIdx = view.getInt32(offset + 20, true);
      const attrStart = view.getUint16(offset + 24, true);
      const attrSize = view.getUint16(offset + 26, true) || 20;
      const attrCount = view.getUint16(offset + 28, true);

      const elemName = nameIdx >= 0 && nameIdx < strings.length ? strings[nameIdx] : '';
      const attrsBase = offset + 16 + attrStart;

      for (let i = 0; i < attrCount; i++) {
        const aOff = attrsBase + i * attrSize;
        if (aOff + 20 > offset + chunkSize) break;

        const attrNameIdx = view.getInt32(aOff + 4, true);
        const rawValueIdx = view.getInt32(aOff + 8, true);
        const dataType = axml[aOff + 15];
        const dataValue = view.getInt32(aOff + 16, true);

        const attrName = attrNameIdx >= 0 && attrNameIdx < strings.length ? strings[attrNameIdx] : '';
        const resId = attrNameIdx >= 0 && attrNameIdx < resourceIds.length ? resourceIds[attrNameIdx] : 0;

        let strVal = '';
        if (rawValueIdx >= 0 && rawValueIdx < strings.length) {
          strVal = strings[rawValueIdx];
        } else if (dataType === 0x03 && dataValue >= 0 && dataValue < strings.length) {
          strVal = strings[dataValue];
        } else {
          strVal = String(dataValue);
        }

        const intVal =
          dataType === 0x10 || dataType === 0x11
            ? dataValue
            : parseInt(strVal, 10);

        if (elemName === 'manifest') {
          if (attrName === 'package' && strVal) {
            packageName = strVal.trim();
          } else if (attrName === 'versionCode' || resId === 0x0101021b) {
            if (!isNaN(intVal)) versionCode = intVal;
          } else if (attrName === 'versionCodeMajor' || resId === 0x01010576) {
            if (!isNaN(intVal)) versionCodeMajor = intVal;
          } else if (attrName === 'versionName' || resId === 0x0101021c) {
            if (strVal) versionName = strVal.trim();
          }
        } else if (elemName === 'uses-sdk') {
          if (attrName === 'minSdkVersion' || resId === 0x0101020c) {
            if (!isNaN(intVal) && intVal > 0) minSdkVersion = intVal;
          } else if (attrName === 'targetSdkVersion' || resId === 0x01010270) {
            if (!isNaN(intVal) && intVal > 0) targetSdkVersion = intVal;
          }
        }
      }
    }

    offset += chunkSize;
  }

  const finalVersionCode = versionCodeMajor > 0 ? (versionCodeMajor * 0x100000000) + (versionCode >>> 0) : versionCode;

  return {
    packageName,
    versionName,
    versionCode: finalVersionCode,
    minSdkVersion,
    targetSdkVersion,
  };
}

/**
 * Inspects a selected File in the browser, extracts binary AndroidManifest.xml metadata,
 * and computes SHA-256 digest.
 */
export async function inspectApkFile(file: File): Promise<{
  metadata: ClientApkMetadata;
  arrayBuffer: ArrayBuffer;
}> {
  if (!file.name.toLowerCase().endsWith('.apk')) {
    throw new Error('Invalid file format: Please select a valid Android .apk file.');
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  if (bytes.length < 64) {
    throw new Error('Invalid APK file: File is empty or too small to be a valid Android package.');
  }

  const manifestBytes = await extractAndroidManifestFromZip(bytes);
  const parsed = parseBinaryAndroidManifest(manifestBytes);

  if (!parsed.packageName) {
    throw new Error('Invalid APK file: Could not read Android package name from AndroidManifest.xml.');
  }
  if (!parsed.versionName) {
    throw new Error('Invalid APK file: Could not read versionName from AndroidManifest.xml.');
  }
  if (!parsed.versionCode || parsed.versionCode <= 0 || !Number.isInteger(parsed.versionCode)) {
    throw new Error('Invalid APK file: Could not read a valid integer versionCode from AndroidManifest.xml.');
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const sha256 = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  const metadata: ClientApkMetadata = {
    packageName: parsed.packageName,
    versionName: parsed.versionName,
    versionCode: parsed.versionCode,
    minSdkVersion: parsed.minSdkVersion,
    targetSdkVersion: parsed.targetSdkVersion,
    minAndroidVersion: formatAndroidSdk(parsed.minSdkVersion, true),
    targetAndroidVersion: parsed.targetSdkVersion ? formatAndroidSdk(parsed.targetSdkVersion, false) : null,
    fileSize: file.size,
    fileSizeFormatted: formatBytes(file.size),
    sha256,
    fileName: file.name,
  };

  return { metadata, arrayBuffer };
}
