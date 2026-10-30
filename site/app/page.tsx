/** Protected, dynamic Site entry point. Server identity is never cached or replaced by browser credentials. */
import { getChatGPTUser,chatGPTSignInPath,chatGPTSignOutPath } from './chatgpt-auth';
import Workspace from './workspace';
export const dynamic='force-dynamic';
/** Show top-level ChatGPT sign-in or the owner-private workspace. */
export default async function Page(){
  const user=await getChatGPTUser();
  if(!user)return <main className="signin"><div className="brand-mark">Lα</div><p className="eyebrow">YOUR PRIVATE PORTFOLIO</p><h1>A clearer view<br/>of every decision.</h1><p>LedgerAlpha brings your holdings, partner ownership and investment history into one private ledger.</p><a className="button primary" target="_top" href={chatGPTSignInPath('/')}>Continue with ChatGPT →</a><small>Your ledger is linked to your ChatGPT account.</small></main>;
  return <Workspace displayName={user.fullName??user.displayName.split('@')[0]} signOutPath={chatGPTSignOutPath('/')}/>;
}
