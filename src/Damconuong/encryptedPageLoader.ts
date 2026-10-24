import { gcm } from "@noble/ciphers/aes";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const REQUEST_VERSION = 1;
const TOKEN_LENGTH = 16;
const AES_GCM_IV_LENGTH = 12;

interface EncryptedPayload {
    e?: unknown;
}

interface DecryptedPagePayload {
    p?: unknown;
    s?: unknown;
}

export interface EncryptedPage {
    src: string;
    key: string | null;
}

export type EncryptedPageRequest = (
    path: string,
    headers: Record<string, string>
) => Promise<EncryptedPayload>;

function encodeBase64Url(bytes: Uint8Array): string {
    let encoded = "";

    for (let offset = 0; offset < bytes.length; offset += 3) {
        const first = bytes[offset] ?? 0;
        const second = bytes[offset + 1] ?? 0;
        const third = bytes[offset + 2] ?? 0;
        const packedBytes = (first << 16) | (second << 8) | third;
        const remainingBytes = bytes.length - offset;
        const characterCount = Math.min(4, Math.ceil((remainingBytes * 8) / 6));

        for (let index = 0; index < characterCount; index += 1) {
            const shift = 18 - 6 * index;
            encoded += BASE64URL_ALPHABET[(packedBytes >> shift) & 0x3f] ?? "";
        }
    }

    return encoded;
}

function decodeBase64Url(encoded: string): Uint8Array {
    const decodedLength = Math.floor((encoded.length * 6) / 8);
    const decoded = new Uint8Array(decodedLength);
    let bitBuffer = 0;
    let availableBits = 0;
    let outputOffset = 0;

    for (const character of encoded) {
        const value = BASE64URL_ALPHABET.indexOf(character);

        if (value < 0) {
            throw new Error("Invalid base64url input");
        }

        bitBuffer = (bitBuffer << 6) | value;
        availableBits += 6;

        if (availableBits >= 8) {
            availableBits -= 8;
            decoded[outputOffset] = (bitBuffer >> availableBits) & 0xff;
            outputOffset += 1;
        }
    }

    return decoded;
}

function encodeUtf8(text: string): Uint8Array {
    const bytes: number[] = [];

    for (const character of text) {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined) continue;

        if (codePoint <= 0x7f) {
            bytes.push(codePoint);
        } else if (codePoint <= 0x7ff) {
            bytes.push(0xc0 | (codePoint >> 6));
            bytes.push(0x80 | (codePoint & 0x3f));
        } else if (codePoint <= 0xffff) {
            bytes.push(0xe0 | (codePoint >> 12));
            bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
            bytes.push(0x80 | (codePoint & 0x3f));
        } else {
            bytes.push(0xf0 | (codePoint >> 18));
            bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
            bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
            bytes.push(0x80 | (codePoint & 0x3f));
        }
    }

    return Uint8Array.from(bytes);
}

function decodeUtf8(bytes: Uint8Array): string {
    let decoded = "";

    for (let index = 0; index < bytes.length;) {
        const first = bytes[index] ?? 0;
        let codePoint: number;
        let width: number;

        if (first < 0x80) {
            codePoint = first;
            width = 1;
        } else if ((first & 0xe0) === 0xc0) {
            codePoint = first & 0x1f;
            width = 2;
        } else if ((first & 0xf0) === 0xe0) {
            codePoint = first & 0x0f;
            width = 3;
        } else if ((first & 0xf8) === 0xf0) {
            codePoint = first & 0x07;
            width = 4;
        } else {
            throw new Error("Invalid UTF-8 payload");
        }

        if (index + width > bytes.length) {
            throw new Error("Invalid UTF-8 payload");
        }

        for (let offset = 1; offset < width; offset += 1) {
            const continuation = bytes[index + offset] ?? 0;
            if ((continuation & 0xc0) !== 0x80) {
                throw new Error("Invalid UTF-8 payload");
            }
            codePoint = (codePoint << 6) | (continuation & 0x3f);
        }

        decoded += String.fromCodePoint(codePoint);
        index += width;
    }

    return decoded;
}

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
    return hmac(sha256, key, message);
}

function splitPagePath(pagePath: string): { mangaId: string; chapterId: string } {
    const separatorIndex = pagePath.indexOf("/");

    if (separatorIndex <= 0 || separatorIndex === pagePath.length - 1) {
        throw new Error("Invalid page path");
    }

    return {
        mangaId: pagePath.slice(0, separatorIndex),
        chapterId: pagePath.slice(separatorIndex + 1),
    };
}

const MASTER_KEY = decodeBase64Url(
    "YVdGuT8RjDWkeQjt7s7mv53smMpLrcKBuGMs8erg8Bs"
);
const TOKEN_KEY = hmacSha256(MASTER_KEY, encodeUtf8("tok"));
const ENCRYPTION_KEY = hmacSha256(MASTER_KEY, encodeUtf8("enc"));

export async function loadEncryptedPages(
    pagePath: string,
    requestJson: EncryptedPageRequest
): Promise<EncryptedPage[]> {
    const fullTokenDigest = hmacSha256(TOKEN_KEY, encodeUtf8(pagePath));
    const tokenDigest = fullTokenDigest.slice(0, TOKEN_LENGTH);
    const requestTokenBytes = new Uint8Array(1 + TOKEN_LENGTH);
    requestTokenBytes[0] = REQUEST_VERSION;
    requestTokenBytes.set(tokenDigest, 1);

    const requestToken = encodeBase64Url(requestTokenBytes);
    const { mangaId, chapterId } = splitPagePath(pagePath);
    const endpoint =
        `/_c/mangas/${encodeURIComponent(mangaId)}` +
        `/chapters/${encodeURIComponent(chapterId)}` +
        `/pages?_=${requestToken}`;

    const response = await requestJson(endpoint, {
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "PostmanRuntime/2.12.2",
    });
    const encryptedPayload = response.e;

    if (typeof encryptedPayload !== "string") {
        throw new Error("Invalid encrypted page response");
    }

    const payloadBytes = decodeBase64Url(encryptedPayload);
    if (payloadBytes.length <= AES_GCM_IV_LENGTH + gcm.tagLength) {
        throw new Error("Invalid encrypted page payload");
    }

    const aesKey = hmacSha256(ENCRYPTION_KEY, encodeUtf8(requestToken));
    const initializationVector = payloadBytes.slice(0, AES_GCM_IV_LENGTH);
    const ciphertext = payloadBytes.slice(AES_GCM_IV_LENGTH);
    const plaintext = gcm(
        aesKey,
        initializationVector,
        encodeUtf8(pagePath)
    ).decrypt(ciphertext);
    const payload = JSON.parse(decodeUtf8(plaintext)) as DecryptedPagePayload;
    const pageSources = payload.p;
    const pageKeys = payload.s;

    if (!Array.isArray(pageSources)) {
        throw new Error("Invalid page payload");
    }

    const hasValidPageKeys =
        pageKeys === undefined ||
        (Array.isArray(pageKeys) &&
            pageKeys.length === pageSources.length &&
            pageKeys.every((key) => typeof key === "string"));

    if (!hasValidPageKeys) {
        throw new Error("Invalid page payload");
    }

    const keys = pageKeys as string[] | undefined;
    const pages: EncryptedPage[] = [];

    for (let index = 0; index < pageSources.length; index += 1) {
        const source = pageSources[index];
        if (typeof source !== "string") continue;

        pages.push({
            src: source,
            key: keys?.[index] || null,
        });
    }

    return pages;
}
