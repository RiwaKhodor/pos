export const Role = {
  OWNER: "OWNER",
  EMPLOYEE: "EMPLOYEE",
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export function isRole(value: string): value is Role {
  return value === Role.OWNER || value === Role.EMPLOYEE;
}
