import { describe, expect, it } from 'vitest'
import { dealerRegisterSchema } from '../../pages/dealers/dealerRegisterSchema'

const valid = {
  companyName: 'Nimal Perera',
  dealerType: 'individual' as const,
  businessAddress: '12 Galle Road',
  city: 'Colombo',
  nicNumber: '200012345678',
  name: 'Nimal Perera',
  countryCode: '+94',
  contactNumber: '771234567',
  email: 'nimal@example.com',
  password: 'Passw0rdX',
  confirmPassword: 'Passw0rdX',
}

/** Field paths that failed validation, e.g. ['businessRegistrationNumber']. */
function failedFields(input: unknown): string[] {
  const result = dealerRegisterSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => String(issue.path[0]))
}

describe('dealerRegisterSchema — business registration number', () => {
  it('lets an individual register without one', () => {
    expect(dealerRegisterSchema.safeParse(valid).success).toBe(true)
  })

  it('treats an empty or blank value as absent for an individual', () => {
    expect(dealerRegisterSchema.safeParse({ ...valid, businessRegistrationNumber: '' }).success).toBe(
      true,
    )
    expect(
      dealerRegisterSchema.safeParse({ ...valid, businessRegistrationNumber: '   ' }).success,
    ).toBe(true)
  })

  it('still accepts one if an individual chooses to provide it', () => {
    expect(
      dealerRegisterSchema.safeParse({ ...valid, businessRegistrationNumber: 'PV 12345' }).success,
    ).toBe(true)
  })

  it('still requires it for a business dealer', () => {
    const business = { ...valid, dealerType: 'business' as const, nicNumber: undefined }

    expect(failedFields(business)).toEqual(['businessRegistrationNumber'])
    expect(failedFields({ ...business, businessRegistrationNumber: '   ' })).toEqual([
      'businessRegistrationNumber',
    ])
    expect(
      dealerRegisterSchema.safeParse({ ...business, businessRegistrationNumber: 'PV 12345' })
        .success,
    ).toBe(true)
  })

  it('rejects a value longer than the 500-character database column', () => {
    expect(
      failedFields({ ...valid, businessRegistrationNumber: 'x'.repeat(501) }),
    ).toContain('businessRegistrationNumber')
  })
})

describe('dealerRegisterSchema — individual identity check is unchanged', () => {
  it('still requires a valid NIC for an individual', () => {
    expect(failedFields({ ...valid, nicNumber: '' })).toEqual(['nicNumber'])
    expect(failedFields({ ...valid, nicNumber: '12345' })).toEqual(['nicNumber'])
  })

  it('accepts both NIC formats', () => {
    expect(dealerRegisterSchema.safeParse({ ...valid, nicNumber: '991234567V' }).success).toBe(true)
    expect(dealerRegisterSchema.safeParse({ ...valid, nicNumber: '200012345678' }).success).toBe(true)
  })
})
