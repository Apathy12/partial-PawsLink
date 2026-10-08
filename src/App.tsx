import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './lib/auth'
import {
  CheckEmailPage, LandingPage, LoginPage, PublicPetPage, RegisterPage, ScanPage, SetupPage
} from './pages/public'
import { VerifyIdentityPage } from './pages/verify'
import { UserProfile } from './pages/profile'
import { UserMatch, UserSaved } from './pages/match'
import { OfficeApplicationDetail, UserApplicationDetail, UserApply } from './pages/application'
import {
  UserApplications, UserBridge, UserHome, UserListing, UserPetDetail, UserPetNew, UserPets, UserScan
} from './pages/user'
import { VetHome, VetPet, VetScan } from './pages/vet'
import {
  OfficeAccounts, OfficeApplications, OfficeHome, OfficeIntake, OfficeListings,
  OfficePet, OfficeRegistrations, OfficeRegistry
} from './pages/office'
import { OfficeVerification } from './pages/verification'
import { OfficeAccount } from './pages/office-account'
import { OfficeMfaPage } from './pages/office-mfa'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/check-email" element={<CheckEmailPage />} />
          <Route path="/verify" element={<RequireAuth allowUnverified><VerifyIdentityPage /></RequireAuth>} />
          <Route path="/p/:slug" element={<PublicPetPage />} />
          <Route path="/scan" element={<ScanPage />} />

          <Route path="/app" element={<RequireAuth roles={['user']}><UserHome /></RequireAuth>} />
          <Route path="/app/pets" element={<RequireAuth roles={['user']}><UserPets /></RequireAuth>} />
          <Route path="/app/pets/new" element={<RequireAuth roles={['user']}><UserPetNew /></RequireAuth>} />
          <Route path="/app/pets/:id" element={<RequireAuth roles={['user']}><UserPetDetail /></RequireAuth>} />
          <Route path="/app/bridge" element={<RequireAuth roles={['user']}><UserBridge /></RequireAuth>} />
          <Route path="/app/match" element={<RequireAuth roles={['user']}><UserMatch /></RequireAuth>} />
          <Route path="/app/saved" element={<RequireAuth roles={['user']}><UserSaved /></RequireAuth>} />
          <Route path="/app/listings/:id" element={<RequireAuth roles={['user']}><UserListing /></RequireAuth>} />
          <Route path="/app/listings/:id/apply" element={<RequireAuth roles={['user']}><UserApply /></RequireAuth>} />
          <Route path="/app/applications" element={<RequireAuth roles={['user']}><UserApplications /></RequireAuth>} />
          <Route path="/app/applications/:id" element={<RequireAuth roles={['user']}><UserApplicationDetail /></RequireAuth>} />
          <Route path="/app/scan" element={<RequireAuth roles={['user']}><UserScan /></RequireAuth>} />
          <Route path="/app/profile" element={<RequireAuth roles={['user']} allowUnverified><UserProfile /></RequireAuth>} />

          <Route path="/vet" element={<RequireAuth roles={['vet']}><VetHome /></RequireAuth>} />
          <Route path="/vet/pets/:id" element={<RequireAuth roles={['vet']}><VetPet /></RequireAuth>} />
          <Route path="/vet/scan" element={<RequireAuth roles={['vet']}><VetScan /></RequireAuth>} />

          <Route path="/office" element={<RequireAuth roles={['cavd']}><OfficeHome /></RequireAuth>} />
          <Route path="/office/mfa" element={<RequireAuth roles={['cavd']} allowMfaSetup><OfficeMfaPage /></RequireAuth>} />
          <Route path="/office/registrations" element={<RequireAuth roles={['cavd']}><OfficeRegistrations /></RequireAuth>} />
          <Route path="/office/listings" element={<RequireAuth roles={['cavd']}><OfficeListings /></RequireAuth>} />
          <Route path="/office/applications" element={<RequireAuth roles={['cavd']}><OfficeApplications /></RequireAuth>} />
          <Route path="/office/applications/:id" element={<RequireAuth roles={['cavd']}><OfficeApplicationDetail /></RequireAuth>} />
          <Route path="/office/intake" element={<RequireAuth roles={['cavd']}><OfficeIntake /></RequireAuth>} />
          <Route path="/office/registry" element={<RequireAuth roles={['cavd']}><OfficeRegistry /></RequireAuth>} />
          <Route path="/office/pets/:id" element={<RequireAuth roles={['cavd']}><OfficePet /></RequireAuth>} />
          <Route path="/office/accounts" element={<RequireAuth roles={['cavd']}><OfficeAccounts /></RequireAuth>} />
          <Route path="/office/accounts/:id" element={<RequireAuth roles={['cavd']}><OfficeAccount /></RequireAuth>} />
          <Route path="/office/verifications" element={<RequireAuth roles={['cavd']}><OfficeVerification /></RequireAuth>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
