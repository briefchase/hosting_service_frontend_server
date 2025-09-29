// Centralized Google OAuth scopes for frontend usage
export const GCP_SCOPES = [
    // Minimum effective scope that covers required Google Cloud APIs
    "https://www.googleapis.com/auth/cloud-platform"
].join(' ');

// Optional granular scopes (kept here as references). Only use these if you
// replace cloud-platform and are certain your calls do not require
// Resource Manager or Service Usage flows that effectively mandate
// cloud-platform:
// "https://www.googleapis.com/auth/compute"
// "https://www.googleapis.com/auth/cloud-billing"
// "https://www.googleapis.com/auth/iam"
// "https://www.googleapis.com/auth/service.management"
// "https://www.googleapis.com/auth/ndev.clouddns.readwrite"

export const PEOPLE_PHONE_SCOPE = "https://www.googleapis.com/auth/user.phonenumbers.read";


