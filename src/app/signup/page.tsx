import SignInForm from '@/components/auth/SignInForm';

export default function SignupPage() {
  return (
    <div
      className="flex items-center justify-center"
      style={{ minHeight: '100vh', padding: 16 }}
    >
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            style={{
              color:         'var(--color-accent)',
              fontWeight:    700,
              letterSpacing: '0.1em',
              fontSize:      'var(--fs-lg)',
            }}
          >
            QUANTDESK
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', marginTop: 4 }}>
            sign up - research terminal access
          </div>
        </div>
        <SignInForm mode="signup" />
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', textAlign: 'center', marginTop: 24 }}>
          Research tool. Not financial advice. All results are hypothetical.
        </p>
      </div>
    </div>
  );
}
