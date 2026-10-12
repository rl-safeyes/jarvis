import { githubErrors } from './github-errors.ts';
import { DomainError } from '@jarvis/storage';
export class SupervisorClient {
  constructor(
    private url: string,
    private token: string,
  ) {}
  async call(input: Record<string, unknown>): Promise<any> {
    try {
      const r = await fetch(`${this.url}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(input.action === 'install' ? 900000 : 60000),
      });
      if (!r.ok) {
        const data = await r.json();
        const messages: Record<string, string> = {
          ...githubErrors,
          auth_failed:
            'La connexion Claude a échoué. Relancez-la et utilisez le code du nouveau lien.',
          auth_session_expired:
            'Cette connexion Claude a expiré ou a été remplacée. Relancez la connexion.',
          invalid_auth_code:
            'Le code Claude est invalide. Copiez le code complet affiché après la connexion.',
          auth_code_submitted: 'Ce code a déjà été transmis. Cliquez sur Vérifier la connexion.',
          account_busy:
            'Ce compte exécute une demande. Attendez sa fin avant de changer sa connexion.',
          runtime_tls_error:
            'Le moteur ne peut pas vérifier le certificat HTTPS du fournisseur. Vérifiez les certificats de son image Docker.',
          runtime_network_error:
            'Le moteur ne parvient pas à joindre le fournisseur en HTTPS. Vérifiez le réseau et les certificats de son conteneur.',
          runtime_provider_refused:
            'Le fournisseur a refusé la demande du moteur. Vérifiez les paramètres du compte et réessayez.',
        };
        const message = Object.hasOwn(messages, data.error_code)
          ? messages[data.error_code]
          : undefined;
        if (message) throw new DomainError(503, data.error_code, message);
        throw new Error();
      }
      return await r.json();
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        503,
        'runtime_unavailable',
        'Le runtime est indisponible ou a refusé la demande. Vérifiez son état dans les réglages.',
      );
    }
  }
}
