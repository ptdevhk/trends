import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function AboutPage() {
  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle>About</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        This is a test page for the <code>/about</code> route.
      </CardContent>
    </Card>
  )
}
