import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmailConfigurationForm } from './EmailConfigurationForm';

/**
 * Standalone Email Configuration page. The form itself lives in
 * EmailConfigurationForm so the Company Settings Email tab renders the
 * exact same configuration UI.
 */
export function EmailSettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Email Configuration"
        description="Company sending account used by standalone email. Credentials are encrypted and never shown back."
        actions={
          <Link to="/emails">
            <Button variant="secondary">Open Email</Button>
          </Link>
        }
      />
      <EmailConfigurationForm />
    </div>
  );
}
