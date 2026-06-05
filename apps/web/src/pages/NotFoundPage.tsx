import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'

type NotFoundPageProps = {
  homePath?: string
}

export function NotFoundPage({ homePath = '/dev/resumes' }: NotFoundPageProps) {
  const { t } = useTranslation()

  return (
    <section className="mx-auto flex min-h-[55vh] max-w-xl flex-col justify-center gap-6 py-12">
      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
        <AlertTriangle className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          {t('notFound.eyebrow', { defaultValue: '404' })}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {t('notFound.title', { defaultValue: 'Page not found' })}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {t('notFound.description', {
            defaultValue: "The page you're looking for doesn't exist or has moved.",
          })}
        </p>
      </div>
      <div>
        <Link to={homePath} className={buttonVariants()}>
          {t('notFound.backToResumes', { defaultValue: 'Back to resumes' })}
        </Link>
      </div>
    </section>
  )
}

export default NotFoundPage
