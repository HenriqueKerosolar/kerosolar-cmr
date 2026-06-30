export const metadata = {
  title: 'Política de Privacidade — KeroSolar Energia Inteligente',
  description: 'Como a KeroSolar coleta, usa, armazena e protege seus dados pessoais.',
}

export default function PoliticaPrivacidade() {
  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '40px 20px', lineHeight: 1.7, color: '#1a1a1a', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>Política de Privacidade — KeroSolar Energia Inteligente</h1>
      <p style={{ color: '#666', marginTop: 0 }}>Última atualização: 21 de junho de 2026</p>

      <p>
        A <strong>KeroSolar Energia Inteligente</strong> respeita a privacidade dos seus clientes, parceiros e
        visitantes. Esta Política de Privacidade descreve como coletamos, utilizamos, armazenamos e protegemos os
        dados pessoais fornecidos através de nossos canais de atendimento, websites, formulários, redes sociais,
        anúncios e WhatsApp. Ao utilizar nossos serviços ou entrar em contato conosco, você concorda com os termos
        desta Política.
      </p>

      <h2 style={h2}>1. Dados que coletamos</h2>
      <p>Coletamos apenas os dados necessários para atender você e elaborar propostas de energia solar:</p>
      <ul>
        <li><strong>Dados de contato:</strong> nome, telefone/WhatsApp e e-mail.</li>
        <li><strong>Dados de consumo:</strong> informações da sua conta de luz (valor, consumo em kWh, distribuidora, tipo de ligação) que você nos envia para o cálculo do orçamento.</li>
        <li><strong>Conteúdo das conversas:</strong> mensagens, imagens e documentos enviados nos canais de atendimento.</li>
        <li><strong>Dados de financiamento (quando aplicável):</strong> informações fornecidas por você para análise de crédito.</li>
        <li><strong>Dados técnicos:</strong> informações de navegação e de origem do contato (ex.: clique em anúncio).</li>
      </ul>

      <h2 style={h2}>2. Como usamos os seus dados</h2>
      <ul>
        <li>Responder às suas mensagens e prestar atendimento.</li>
        <li>Elaborar orçamentos e simulações de energia solar.</li>
        <li>Encaminhar e acompanhar processos de financiamento, quando solicitado.</li>
        <li>Agendar visitas técnicas, instalação e homologação.</li>
        <li>Enviar comunicações sobre o seu atendimento e, quando autorizado, ofertas e novidades.</li>
        <li>Melhorar nossos serviços e o atendimento.</li>
      </ul>

      <h2 style={h2}>3. WhatsApp e plataformas Meta</h2>
      <p>
        Nosso atendimento por WhatsApp utiliza a <strong>API oficial do WhatsApp Business (Meta)</strong>. As
        mensagens trocadas são processadas para viabilizar o atendimento. O uso do WhatsApp também está sujeito à
        Política de Privacidade da Meta. Não enviamos mensagens não solicitadas a quem pediu para não ser contatado.
      </p>

      <h2 style={h2}>4. Compartilhamento de dados</h2>
      <p>
        <strong>Não vendemos os seus dados.</strong> Podemos compartilhá-los apenas quando necessário para a
        prestação do serviço, com: parceiros e prestadores envolvidos na instalação e homologação; instituições
        financeiras, exclusivamente para análise de financiamento que você solicitar; e autoridades, quando exigido
        por lei.
      </p>

      <h2 style={h2}>5. Armazenamento e segurança</h2>
      <p>
        Adotamos medidas técnicas e organizacionais para proteger os seus dados contra acesso não autorizado, perda
        ou uso indevido. O acesso é restrito às pessoas necessárias para o atendimento.
      </p>

      <h2 style={h2}>6. Retenção</h2>
      <p>
        Mantemos os seus dados pelo tempo necessário para as finalidades acima e para o cumprimento de obrigações
        legais. Após esse período, os dados são eliminados ou anonimizados.
      </p>

      <h2 style={h2}>7. Seus direitos (LGPD)</h2>
      <p>Conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você pode, a qualquer momento:</p>
      <ul>
        <li>Confirmar a existência de tratamento e acessar os seus dados.</li>
        <li>Corrigir dados incompletos, inexatos ou desatualizados.</li>
        <li>Solicitar a anonimização, bloqueio ou eliminação de dados desnecessários.</li>
        <li>Revogar o consentimento e solicitar a exclusão dos seus dados.</li>
        <li>Obter informações sobre o compartilhamento dos seus dados.</li>
      </ul>
      <p>Para exercer esses direitos, entre em contato pelos canais abaixo.</p>

      <h2 style={h2}>8. Cookies</h2>
      <p>
        Nossos sites podem usar cookies para melhorar a navegação e medir resultados de anúncios. Você pode gerenciar
        os cookies nas configurações do seu navegador.
      </p>

      <h2 style={h2}>9. Alterações desta Política</h2>
      <p>
        Esta Política pode ser atualizada periodicamente. A data da última atualização é indicada no topo desta
        página.
      </p>

      <h2 style={h2}>10. Contato</h2>
      <p>
        Dúvidas ou solicitações sobre os seus dados? Fale com a gente:
      </p>
      <ul>
        <li><strong>E-mail:</strong> kerosolar@kerosolar.com.br</li>
        <li><strong>WhatsApp:</strong> +55 21 2027-6013</li>
      </ul>

      <p style={{ color: '#888', fontSize: 13, marginTop: 40, borderTop: '1px solid #eee', paddingTop: 16 }}>
        © {new Date().getFullYear()} KeroSolar Energia Inteligente. Todos os direitos reservados.
      </p>
    </main>
  )
}

const h2 = { fontSize: 19, fontWeight: 700, marginTop: 28, marginBottom: 6 } as const
