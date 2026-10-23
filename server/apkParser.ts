import zlib from 'zlib';

export const OFFICIAL_ZOYA_PACKAGE = 'com.riyajul.zoya';

export interface ExtractedApkMetadata {
  packageName: string;
  versionName: string;
  versionCode: number;
  minSdkVersion: number | null;
  targetSdkVersion: number | null;
  minAndroidVersion: string;
  targetAndroidVersion: string | null;
  fileSize: number;
  fileSizeFormatted: string;
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

/**
 * Extracts raw AndroidManifest.xml bytes from an APK (ZIP) buffer.
 * Supports both Central Directory lookup (handles streaming data descriptors)
 * and Local File Header scanning.
 */
function extractAndroidManifestBytes(zipBuffer: Buffer): Buffer {
  if (
    zipBuffer.length < 22 ||
    zipBuffer[0] !== 0x50 ||
    zipBuffer[1] !== 0x4b ||
    zipBuffer[2] !== 0x03 ||
    zipBuffer[3] !== 0x04
  ) {
    throw new Error('Invalid APK file: File is not a valid ZIP/APK archive.');
  }

  // 1. Locate End of Central Directory (EOCD) record (0x06054b50) from the end of buffer
  const maxCommentLength = 65535;
  const searchStart = Math.max(0, zipBuffer.length - 22 - maxCommentLength);
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= searchStart; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
    const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

    if (cdOffset + cdSize <= zipBuffer.length) {
      let ptr = cdOffset;
      const cdEnd = cdOffset + cdSize;
      while (ptr + 46 <= cdEnd) {
        const sig = zipBuffer.readUInt32LE(ptr);
        if (sig !== 0x02014b45) break;

        const compressionMethod = zipBuffer.readUInt16LE(ptr + 10);
        const compressedSize = zipBuffer.readUInt32LE(ptr + 20);
        const fileNameLen = zipBuffer.readUInt16LE(ptr + 28);
        const extraLen = zipBuffer.readUInt16LE(ptr + 30);
        const commentLen = zipBuffer.readUInt16LE(ptr + 32);
        const localHeaderOffset = zipBuffer.readUInt32LE(ptr + 42);

        const nameStart = ptr + 46;
        if (nameStart + fileNameLen > zipBuffer.length) break;
        const entryName = zipBuffer.subarray(nameStart, nameStart + fileNameLen).toString('utf8');

        if (entryName === 'AndroidManifest.xml') {
          if (localHeaderOffset + 30 > zipBuffer.length) {
            throw new Error('Corrupted APK: Invalid local header offset for AndroidManifest.xml.');
          }
          const localSig = zipBuffer.readUInt32LE(localHeaderOffset);
          if (localSig !== 0x04034b50) {
            throw new Error('Corrupted APK: Invalid local file header signature for AndroidManifest.xml.');
          }
          const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
          const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
          const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
          const dataEnd = dataStart + compressedSize;

          if (dataEnd > zipBuffer.length) {
            throw new Error('Corrupted APK: AndroidManifest.xml data extends beyond file boundary.');
          }

          const rawSlice = zipBuffer.subarray(dataStart, dataEnd);
          if (compressionMethod === 0) {
            return rawSlice;
          }
          if (compressionMethod === 8) {
            return zlib.inflateRawSync(rawSlice);
          }
          throw new Error(`Unsupported ZIP compression method (${compressionMethod}) for AndroidManifest.xml.`);
        }

        ptr = nameStart + fileNameLen + extraLen + commentLen;
      }
    }
  }

  // 2. Fallback: Scan Local File Headers sequentially
  let offset = 0;
  while (offset + 30 <= zipBuffer.length) {
    const sig = zipBuffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const fileNameLen = zipBuffer.readUInt16LE(offset + 26);
    const extraLen = zipBuffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;

    if (nameStart + fileNameLen > zipBuffer.length) break;
    const entryName = zipBuffer.subarray(nameStart, nameStart + fileNameLen).toString('utf8');
    const dataStart = nameStart + fileNameLen + extraLen;
    const dataEnd = dataStart + compressedSize;

    if (entryName === 'AndroidManifest.xml') {
      if (dataEnd > zipBuffer.length || compressedSize === 0) {
        throw new Error('Invalid APK: Cannot read AndroidManifest.xml payload.');
      }
      const rawSlice = zipBuffer.subarray(dataStart, dataEnd);
      if (compressionMethod === 0) return rawSlice;
      if (compressionMethod === 8) return zlib.inflateRawSync(rawSlice);
      throw new Error(`Unsupported compression method (${compressionMethod}) for AndroidManifest.xml.`);
    }

    if (compressedSize === 0) break;
    offset = dataEnd;
  }

  throw new Error('Invalid APK file: AndroidManifest.xml was not found inside the archive.');
}

/**
 * Decodes Android Binary XML (AXML) format from AndroidManifest.xml
 * to extract packageName, versionCode, versionName, minSdkVersion, and targetSdkVersion.
 */
function parseBinaryAndroidManifest(axml: Buffer): {
  packageName: string;
  versionName: string;
  versionCode: number;
  minSdkVersion: number | null;
  targetSdkVersion: number | null;
} {
  if (axml.length < 8) {
    throw new Error('Invalid AndroidManifest.xml: File is too small.');
  }

  const xmlChunkType = axml.readUInt16LE(0);
  const xmlHeaderSize = axml.readUInt16LE(2);
  if (xmlChunkType !== 0x0003) {
    throw new Error('Invalid AndroidManifest.xml: Not in compiled Android Binary XML (AXML) format.');
  }

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
    const chunkType = axml.readUInt16LE(offset);
    const headerSize = axml.readUInt16LE(offset + 2);
    const chunkSize = axml.readUInt32LE(offset + 4);

    if (chunkSize < 8 || offset + chunkSize > axml.length) {
      break;
    }

    // RES_STRING_POOL_TYPE = 0x0001
    if (chunkType === 0x0001) {
      const stringCount = axml.readUInt32LE(offset + 8);
      const flags = axml.readUInt32LE(offset + 16);
      const stringsStart = axml.readUInt32LE(offset + 20);
      const isUtf8 = (flags & 0x0100) !== 0;

      const offsetsBase = offset + headerSize;
      const poolDataBase = offset + stringsStart;
      strings = new Array(stringCount);

      for (let i = 0; i < stringCount; i++) {
        if (offsetsBase + (i + 1) * 4 > offset + chunkSize) {
          strings[i] = '';
          continue;
        }
        const strOffset = poolDataBase + axml.readUInt32LE(offsetsBase + i * 4);
        if (strOffset >= offset + chunkSize) {
          strings[i] = '';
          continue;
        }

        if (isUtf8) {
          let p = strOffset;
          // Skip UTF-16 length (1 or 2 bytes)
          const u16Len = axml[p++];
          if ((u16Len & 0x80) !== 0) p++;
          // Read UTF-8 byte length (1 or 2 bytes)
          let u8Len = axml[p++];
          if ((u8Len & 0x80) !== 0) {
            u8Len = ((u8Len & 0x7f) << 8) | axml[p++];
          }
          strings[i] = axml.subarray(p, Math.min(p + u8Len, offset + chunkSize)).toString('utf8');
        } else {
          let p = strOffset;
          let u16Len = axml.readUInt16LE(p);
          p += 2;
          if ((u16Len & 0x8000) !== 0) {
            u16Len = ((u16Len & 0x7fff) << 16) | axml.readUInt16LE(p);
            p += 2;
          }
          const byteLen = u16Len * 2;
          strings[i] = axml.subarray(p, Math.min(p + byteLen, offset + chunkSize)).toString('utf16le');
        }
      }
    }
    // RES_XML_RESOURCE_MAP_TYPE = 0x0180
    else if (chunkType === 0x0180) {
      const count = Math.floor((chunkSize - headerSize) / 4);
      resourceIds = new Array(count);
      for (let i = 0; i < count; i++) {
        resourceIds[i] = axml.readUInt32LE(offset + headerSize + i * 4);
      }
    }
    // RES_XML_START_ELEMENT_TYPE = 0x0102
    else if (chunkType === 0x0102) {
      const nameIdx = axml.readInt32LE(offset + 20);
      const attrStart = axml.readUInt16LE(offset + 24);
      const attrSize = axml.readUInt16LE(offset + 26) || 20;
      const attrCount = axml.readUInt16LE(offset + 28);

      const elemName = nameIdx >= 0 && nameIdx < strings.length ? strings[nameIdx] : '';
      const attrsBase = offset + 16 + attrStart;

      for (let i = 0; i < attrCount; i++) {
        const aOff = attrsBase + i * attrSize;
        if (aOff + 20 > offset + chunkSize) break;

        const attrNameIdx = axml.readInt32LE(aOff + 4);
        const rawValueIdx = axml.readInt32LE(aOff + 8);
        const dataType = axml[aOff + 15];
        const dataValue = axml.readInt32LE(aOff + 16);

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
 * Inspects an Android APK buffer, validates its ZIP & binary AndroidManifest.xml structure,
 * and returns extracted release metadata.
 */
export function parseApkBuffer(apkBuffer: Buffer): ExtractedApkMetadata {
  if (!apkBuffer || apkBuffer.length < 64) {
    throw new Error('Invalid APK file: File is empty or too small to be an Android APK.');
  }

  const manifestBytes = extractAndroidManifestBytes(apkBuffer);
  const parsed = parseBinaryAndroidManifest(manifestBytes);

  if (!parsed.packageName) {
    throw new Error('Invalid APK file: Could not extract Android package name from AndroidManifest.xml.');
  }
  if (!parsed.versionName) {
    throw new Error('Invalid APK file: Could not extract versionName from AndroidManifest.xml.');
  }
  if (!parsed.versionCode || parsed.versionCode <= 0 || !Number.isInteger(parsed.versionCode)) {
    throw new Error('Invalid APK file: Could not extract a valid integer versionCode from AndroidManifest.xml.');
  }

  const fileSize = apkBuffer.length;

  return {
    packageName: parsed.packageName,
    versionName: parsed.versionName,
    versionCode: parsed.versionCode,
    minSdkVersion: parsed.minSdkVersion,
    targetSdkVersion: parsed.targetSdkVersion,
    minAndroidVersion: formatAndroidSdk(parsed.minSdkVersion, true),
    targetAndroidVersion: parsed.targetSdkVersion ? formatAndroidSdk(parsed.targetSdkVersion, false) : null,
    fileSize,
    fileSizeFormatted: formatBytes(fileSize),
  };
}
