export interface AuthenticatedUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
  provider: 'google';
  createdAt: string;
  lastLoginAt: string;
}

export interface UserLinkedDeviceView {
  deviceModel: string;
  androidVersion: string | null;
  appVersion: string | null;
  linkedAt: string;
}

export interface UserLicenseView {
  id: string;
  maskedKey: string;
  licenseType: 'Lifetime';
  status: 'unactivated' | 'active' | 'revoked';
  createdAt: string;
  activatedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  canRevealKey: boolean;
  canUnbindDevice: boolean;
  lastUnboundAt: string | null;
  nextUnbindAvailableAt: string | null;
  matchMethod: 'user_sub' | 'verified_email';
  linkedDevice: UserLinkedDeviceView | null;
}

export interface UserLicenseSummary {
  status: 'active' | 'unactivated' | 'revoked' | 'not_purchased';
  hasLicense: boolean;
  license: UserLicenseView | null;
  licenseCount: number;
  linkageMode: 'user_sub_or_verified_email';
}

export interface AccountDashboardPayload {
  success: boolean;
  user: AuthenticatedUser;
  licenseSummary: UserLicenseSummary;
}
