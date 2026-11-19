import { describe, expect, it } from 'vitest'
import { ehSoLinkDeVideo, textoAvisoFora, AVISO_FORA } from './fora-do-assunto'

describe('ehSoLinkDeVideo', () => {
  it('links de vídeo de rede social (com ou sem comentário curto)', () => {
    for (const t of [
      'https://www.instagram.com/reel/Df0nc7hoiF4/?avpt=MXR1ZWZmc2RkZmg0Ng==',
      'https://vt.tiktok.com/ZSpWBMbNd/',
      'Tenho que tentar mais coisas!😁 https://kwai-video.com/p/vLVCKEVd',
      'https://youtu.be/abc123',
      'olha isso https://www.youtube.com/shorts/xyz',
      'https://fb.watch/abc/',
    ]) expect(ehSoLinkDeVideo(t)).toBe(true)
  })
  it('não é spam', () => {
    for (const t of [
      'Olá! Posso ter mais informações sobre isso?',
      'https://kerosolar.com.br/w/K7F2X',
      'Minha conta vem 600 reais, segue o link da fatura https://agenciavirtual.light.com.br/fatura/123',
      'Vi um vídeo de vocês https://www.instagram.com/reel/abc e queria saber quanto fica pra minha casa que gasta 500 kwh por mês, tenho telhado colonial',
    ]) expect(ehSoLinkDeVideo(t)).toBe(false)
  })
  it('os dois avisos contam como aviso; o 2º avisa do bloqueio', () => {
    expect(textoAvisoFora('Bom dia', 1)).toContain(AVISO_FORA)
    expect(textoAvisoFora('Bom dia', 2)).toContain('será bloqueado')
  })
})
