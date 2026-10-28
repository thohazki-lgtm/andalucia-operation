type BrandWordmarkProps = {
  className?: string
}

export function BrandWordmark({ className = '' }: BrandWordmarkProps) {
  return <div className={`andalucia-wordmark${className ? ` ${className}` : ''}`}>
    <img className="andalucia-wordmark-image" src="/andalucia-mosaic-wordmark.png" alt="Andalucía" />
    <span className="brand-operation">OPERATION</span>
  </div>
}
