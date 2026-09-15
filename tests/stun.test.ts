import { describe, expect, it } from 'vitest'
import { buildBindingRequest, parseBindingResponse } from '../src/main/network/stun'

function makeResponse(txId: Buffer, ip: number[], port: number, xor: boolean): Buffer {
  const magic = 0x2112a442
  const attr = Buffer.alloc(12)
  attr.writeUInt16BE(xor ? 0x0020 : 0x0001, 0)
  attr.writeUInt16BE(8, 2)
  attr.writeUInt8(0, 4)
  attr.writeUInt8(1, 5) // IPv4
  attr.writeUInt16BE(xor ? port ^ (magic >>> 16) : port, 6)
  const addr = ((ip[0] << 24) | (ip[1] << 16) | (ip[2] << 8) | ip[3]) >>> 0
  attr.writeUInt32BE(xor ? (addr ^ magic) >>> 0 : addr, 8)
  const head = Buffer.alloc(20)
  head.writeUInt16BE(0x0101, 0)
  head.writeUInt16BE(attr.length, 2)
  head.writeUInt32BE(magic, 4)
  txId.copy(head, 8)
  return Buffer.concat([head, attr])
}

describe('stun', () => {
  const txId = Buffer.from('0102030405060708090a0b0c', 'hex')

  it('builds a valid binding request', () => {
    const req = buildBindingRequest(txId)
    expect(req.length).toBe(20)
    expect(req.readUInt16BE(0)).toBe(0x0001)
    expect(req.readUInt32BE(4)).toBe(0x2112a442)
    expect(req.subarray(8).equals(txId)).toBe(true)
  })

  it('parses XOR-MAPPED-ADDRESS', () => {
    const res = parseBindingResponse(makeResponse(txId, [203, 0, 113, 7], 54321, true), txId)
    expect(res).toEqual({ ip: '203.0.113.7', port: 54321 })
  })

  it('parses legacy MAPPED-ADDRESS', () => {
    const res = parseBindingResponse(makeResponse(txId, [198, 51, 100, 9], 4000, false), txId)
    expect(res).toEqual({ ip: '198.51.100.9', port: 4000 })
  })

  it('rejects mismatched transaction id and garbage', () => {
    expect(parseBindingResponse(makeResponse(txId, [1, 2, 3, 4], 1, true), Buffer.alloc(12))).toBeNull()
    expect(parseBindingResponse(Buffer.alloc(3), txId)).toBeNull()
  })
})
