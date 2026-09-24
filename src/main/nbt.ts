import { gunzipSync, gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'

/**
 * Dependency-free NBT (Named Binary Tag) codec, big-endian, gzip container
 * as used by Minecraft level.dat. Longs are BigInts. Compounds are plain
 * objects, so tag order and unknown tags survive a read -> write round trip.
 */

export const TAG_END = 0
export const TAG_BYTE = 1
export const TAG_SHORT = 2
export const TAG_INT = 3
export const TAG_LONG = 4
export const TAG_FLOAT = 5
export const TAG_DOUBLE = 6
export const TAG_BYTE_ARRAY = 7
export const TAG_STRING = 8
export const TAG_LIST = 9
export const TAG_COMPOUND = 10
export const TAG_INT_ARRAY = 11
export const TAG_LONG_ARRAY = 12

export interface NbtTag {
  type: number
  value: NbtValue
}

export type NbtValue =
  | number // byte, short, int, float, double
  | bigint // long
  | string
  | Int8Array // byte array
  | Int32Array // int array
  | BigInt64Array // long array
  | NbtTag[] // list (tags without names, homogeneous type)
  | NbtCompound // compound

export interface NbtCompound {
  [name: string]: NbtTag
}

class Reader {
  private pos = 0
  constructor(private readonly buf: Buffer) {}

  private need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new Error(`NBT: unexpected end of data at offset ${this.pos} (need ${n} bytes)`)
    }
  }

  u8(): number {
    this.need(1)
    return this.buf.readUInt8(this.pos++)
  }

  i8(): number {
    this.need(1)
    return this.buf.readInt8(this.pos++)
  }

  i16(): number {
    this.need(2)
    const v = this.buf.readInt16BE(this.pos)
    this.pos += 2
    return v
  }

  i32(): number {
    this.need(4)
    const v = this.buf.readInt32BE(this.pos)
    this.pos += 4
    return v
  }

  i64(): bigint {
    this.need(8)
    const v = this.buf.readBigInt64BE(this.pos)
    this.pos += 8
    return v
  }

  f32(): number {
    this.need(4)
    const v = this.buf.readFloatBE(this.pos)
    this.pos += 4
    return v
  }

  f64(): number {
    this.need(8)
    const v = this.buf.readDoubleBE(this.pos)
    this.pos += 8
    return v
  }

  string(): string {
    const len = this.buf.readUInt16BE(this.pos)
    this.need(2 + len)
    const v = this.buf.toString('utf8', this.pos + 2, this.pos + 2 + len)
    this.pos += 2 + len
    return v
  }

  byteArray(): Int8Array {
    const len = this.i32()
    this.need(len)
    const view = new Int8Array(this.buf.subarray(this.pos, this.pos + len))
    this.pos += len
    return view
  }

  intArray(): Int32Array {
    const len = this.i32()
    const out = new Int32Array(len)
    for (let i = 0; i < len; i++) out[i] = this.i32()
    return out
  }

  longArray(): BigInt64Array {
    const len = this.i32()
    const out = new BigInt64Array(len)
    for (let i = 0; i < len; i++) out[i] = this.i64()
    return out
  }

  payload(type: number): NbtValue {
    switch (type) {
      case TAG_BYTE:
        return this.i8()
      case TAG_SHORT:
        return this.i16()
      case TAG_INT:
        return this.i32()
      case TAG_LONG:
        return this.i64()
      case TAG_FLOAT:
        return this.f32()
      case TAG_DOUBLE:
        return this.f64()
      case TAG_BYTE_ARRAY:
        return this.byteArray()
      case TAG_STRING:
        return this.string()
      case TAG_LIST:
        return this.list()
      case TAG_COMPOUND:
        return this.compound()
      case TAG_INT_ARRAY:
        return this.intArray()
      case TAG_LONG_ARRAY:
        return this.longArray()
      default:
        throw new Error(`NBT: unknown tag type ${type} at offset ${this.pos}`)
    }
  }

  list(): NbtTag[] {
    const elemType = this.u8()
    const len = this.i32()
    const out: NbtTag[] = []
    for (let i = 0; i < len; i++) {
      out.push({ type: elemType, value: this.payload(elemType) })
    }
    return out
  }

  compound(): NbtCompound {
    const out: NbtCompound = {}
    for (;;) {
      const type = this.u8()
      if (type === TAG_END) return out
      const name = this.string()
      out[name] = { type, value: this.payload(type) }
    }
  }
}

class Writer {
  private buf: Buffer
  private len = 0

  constructor(capacity = 4096) {
    this.buf = Buffer.allocUnsafe(Math.max(capacity, 64))
  }

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return
    let cap = this.buf.length * 2
    while (cap < this.len + n) cap *= 2
    const next = Buffer.allocUnsafe(cap)
    this.buf.copy(next, 0, 0, this.len)
    this.buf = next
  }

  u8(v: number): void {
    this.ensure(1)
    this.buf.writeUInt8(v & 0xff, this.len)
    this.len += 1
  }

  i8(v: number): void {
    this.ensure(1)
    this.buf.writeInt8(v, this.len)
    this.len += 1
  }

  i16(v: number): void {
    this.ensure(2)
    this.buf.writeInt16BE(v, this.len)
    this.len += 2
  }

  i32(v: number): void {
    this.ensure(4)
    this.buf.writeInt32BE(v, this.len)
    this.len += 4
  }

  i64(v: bigint): void {
    this.ensure(8)
    this.buf.writeBigInt64BE(v, this.len)
    this.len += 8
  }

  f32(v: number): void {
    this.ensure(4)
    this.buf.writeFloatBE(v, this.len)
    this.len += 4
  }

  f64(v: number): void {
    this.ensure(8)
    this.buf.writeDoubleBE(v, this.len)
    this.len += 8
  }

  bytes(v: Uint8Array): void {
    this.ensure(v.length)
    Buffer.from(v.buffer, v.byteOffset, v.byteLength).copy(this.buf, this.len)
    this.len += v.length
  }

  string(v: string): void {
    const data = Buffer.from(v, 'utf8')
    if (data.length > 0xffff) throw new Error('NBT: string too long')
    this.i16(data.length)
    this.bytes(data)
  }

  typed(type: number, value: NbtValue): void {
    switch (type) {
      case TAG_BYTE:
        this.i8(value as number)
        return
      case TAG_SHORT:
        this.i16(value as number)
        return
      case TAG_INT:
        this.i32(value as number)
        return
      case TAG_LONG:
        this.i64(value as bigint)
        return
      case TAG_FLOAT:
        this.f32(value as number)
        return
      case TAG_DOUBLE:
        this.f64(value as number)
        return
      case TAG_BYTE_ARRAY: {
        const arr = value as Int8Array
        this.i32(arr.length)
        this.bytes(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength))
        return
      }
      case TAG_STRING:
        this.string(value as string)
        return
      case TAG_LIST: {
        const list = value as NbtTag[]
        if (list.length === 0) {
          this.u8(TAG_END)
          this.i32(0)
          return
        }
        this.u8(list[0].type)
        this.i32(list.length)
        for (const item of list) this.typed(item.type, item.value)
        return
      }
      case TAG_COMPOUND: {
        const compound = value as NbtCompound
        for (const [name, tag] of Object.entries(compound)) {
          this.u8(tag.type)
          this.string(name)
          this.typed(tag.type, tag.value)
        }
        this.u8(TAG_END)
        return
      }
      case TAG_INT_ARRAY: {
        const arr = value as Int32Array
        this.i32(arr.length)
        for (let i = 0; i < arr.length; i++) this.i32(arr[i])
        return
      }
      case TAG_LONG_ARRAY: {
        const arr = value as BigInt64Array
        this.i32(arr.length)
        for (let i = 0; i < arr.length; i++) this.i64(arr[i])
        return
      }
      default:
        throw new Error(`NBT: cannot write tag type ${type}`)
    }
  }

  finish(): Buffer {
    return this.buf.subarray(0, this.len)
  }
}

/** Parse an uncompressed NBT buffer; returns the root compound's value. */
export function parseNbt(buffer: Buffer): NbtCompound {
  const reader = new Reader(buffer)
  const rootType = reader.u8()
  if (rootType !== TAG_COMPOUND) {
    throw new Error(`NBT: expected root TAG_Compound, got type ${rootType}`)
  }
  reader.string() // root name, conventionally ""
  return reader.compound()
}

/** Serialize a root compound back into an uncompressed NBT buffer. */
export function writeNbt(compound: NbtCompound): Buffer {
  const writer = new Writer()
  writer.u8(TAG_COMPOUND)
  writer.string('')
  writer.typed(TAG_COMPOUND, compound)
  return writer.finish()
}

/** Read and decompress a level.dat (gzip'd NBT) file. */
export function readLevelDat(path: string): NbtCompound {
  return parseNbt(gunzipSync(readFileSync(path)))
}

/** Write a compound back to a gzip'd NBT level.dat file. */
export function writeLevelDat(path: string, compound: NbtCompound): void {
  writeFileSync(path, gzipSync(writeNbt(compound)))
}

// ---- convenience accessors -------------------------------------------------

export function child(compound: NbtCompound, key: string): NbtTag | undefined {
  return compound[key]
}

export function compoundChild(compound: NbtCompound, key: string): NbtCompound | null {
  const tag = compound[key]
  return tag && tag.type === TAG_COMPOUND ? (tag.value as NbtCompound) : null
}

export function numberChild(compound: NbtCompound, key: string): number | null {
  const tag = compound[key]
  if (!tag) return null
  if (
    tag.type === TAG_BYTE ||
    tag.type === TAG_SHORT ||
    tag.type === TAG_INT ||
    tag.type === TAG_FLOAT ||
    tag.type === TAG_DOUBLE
  ) {
    return tag.value as number
  }
  return null
}

export function longChild(compound: NbtCompound, key: string): bigint | null {
  const tag = compound[key]
  return tag && tag.type === TAG_LONG ? (tag.value as bigint) : null
}

export function stringChild(compound: NbtCompound, key: string): string | null {
  const tag = compound[key]
  return tag && tag.type === TAG_STRING ? (tag.value as string) : null
}
