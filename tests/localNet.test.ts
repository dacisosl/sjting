import { describe, expect, it } from 'vitest'
import { isCgnatRange, isPrivateIpv4, isPublicIpv4 } from '../src/main/network/localNet'

describe('ip classification', () => {
  it('detects private ranges', () => {
    expect(isPrivateIpv4('10.0.0.1')).toBe(true)
    expect(isPrivateIpv4('172.16.5.5')).toBe(true)
    expect(isPrivateIpv4('172.32.0.1')).toBe(false)
    expect(isPrivateIpv4('192.168.1.1')).toBe(true)
    expect(isPrivateIpv4('127.0.0.1')).toBe(true)
    expect(isPrivateIpv4('169.254.1.1')).toBe(true)
    expect(isPrivateIpv4('8.8.8.8')).toBe(false)
  })

  it('detects CGNAT shared address space (100.64.0.0/10)', () => {
    expect(isCgnatRange('100.64.0.1')).toBe(true)
    expect(isCgnatRange('100.127.255.254')).toBe(true)
    expect(isCgnatRange('100.128.0.1')).toBe(false)
    expect(isCgnatRange('100.63.255.255')).toBe(false)
  })

  it('public ipv4 excludes private and cgnat', () => {
    expect(isPublicIpv4('203.0.113.1')).toBe(true)
    expect(isPublicIpv4('100.64.1.1')).toBe(false)
    expect(isPublicIpv4('192.168.0.1')).toBe(false)
    expect(isPublicIpv4('not-an-ip')).toBe(false)
  })
})
