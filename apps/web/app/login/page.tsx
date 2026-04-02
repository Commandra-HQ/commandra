import { redirect } from 'next/navigation';

/** Legacy path; product auth is Clerk at `/sign-in`. (Old email/password UI lived here.) */
export default function LoginPage() {
	redirect('/sign-in');
}
