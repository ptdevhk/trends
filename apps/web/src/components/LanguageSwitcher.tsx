import { useTranslation } from 'react-i18next'
import { Select } from '@/components/ui/select'

const LANGUAGES = [
  { value: 'zh-Hant', label: '繁體中文' },
  { value: 'zh-Hans', label: '简体中文' },
  { value: 'en', label: 'English' },
]

export function LanguageSwitcher() {
  const { i18n } = useTranslation()

  const currentLang = (() => {
    const lang = i18n.language
    if (lang.startsWith('zh-Hant') || lang === 'zh-TW' || lang === 'zh-HK') {
      return 'zh-Hant'
    }
    if (lang.startsWith('zh')) {
      return 'zh-Hans'
    }
    if (lang.startsWith('en')) {
      return 'en'
    }
    return 'zh-Hant'
  })()

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    i18n.changeLanguage(e.target.value)
  }

  return (
    <Select
      options={LANGUAGES}
      value={currentLang}
      onChange={handleChange}
      className="w-32"
    />
  )
}
