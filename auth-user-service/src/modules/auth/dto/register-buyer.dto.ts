export class RegisterBuyerDto {
  email!: string;
  password!: string;
  name!: string;
}

// Backward-compatible name for code that still imports RegisterDto.
export { RegisterBuyerDto as RegisterDto };
