import { ModelPicker } from '../components/ModelPicker'
import { RuntimeSettings } from '../components/RuntimeSettings'

export function ModelSetup({ providers }: { providers(): void }) {
  return <main data-testid="model-setup" style={{ maxWidth: 880, margin: '0 auto', padding: '70px 28px 40px', overflow: 'auto', height: '100%' }}>
    <h1 style={{ fontSize: 28, fontWeight: 650 }}>Set up your models</h1>
    <p style={{ marginTop: 12 }}>Yogurt checks this app’s model folder, official Yogurt models, and common local model caches before downloading. Choose files to reuse, or continue with the recommended downloads.</p>
    <button style={{ marginTop: 14, textDecoration: 'underline' }} onClick={providers}>Choose summary provider or project settings</button>
    <ModelPicker initial />
    <RuntimeSettings />
  </main>
}
