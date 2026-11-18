import { useLang, setLang } from '../core/i18n';

/** English ⇄ Arabic (remembered on this device). The button shows the language you switch to. */
export function LangSwitch({ wide }: { wide?: boolean }) {
  const l = useLang();
  const to = l === 'ar' ? 'en' : 'ar';
  return <button type="button" className={wide ? 'btn ghost sm lang-switch' : 'icon-btn lang-switch'} data-no-tr title={to === 'ar' ? 'العربية' : 'English'} onClick={() => setLang(to)}>
    {wide ? (to === 'ar' ? 'العربية' : 'English') : (to === 'ar' ? 'ع' : 'EN')}</button>;
}
