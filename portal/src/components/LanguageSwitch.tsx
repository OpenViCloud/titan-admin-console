import { useLang, useT } from '@/i18n/LanguageContext'
import type { Lang } from '@/i18n/lang'
import { cn } from '@/lib/utils'

// The language choice on the admin 403 screen, shown before the admin shell: the account menu is not there
// yet (titan-ops features/cloud-console/design.md#portal-language).
export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setLang } = useLang()
  const t = useT()
  const options: { value: Lang; label: string }[] = [
    { value: 'en', label: t.language.english },
    { value: 'vi', label: t.language.vietnamese },
  ]
  return (
    <div role="group" aria-label={t.language.title} className={cn('flex items-center gap-1 text-[12.5px]', className)}>
      {options.map(option => {
        const selected = lang === option.value
        return (
          <button
            key={option.value}
            type="button"
            lang={option.value}
            aria-pressed={selected}
            onClick={() => setLang(option.value)}
            className={cn(
              'rounded-md px-2 py-1',
              selected ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
