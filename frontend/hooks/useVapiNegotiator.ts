'use client'
import { useEffect, useRef, useState } from 'react'

export function useVapiNegotiator() {
  const vapiRef = useRef<any>(null)
  const [callActive, setCallActive] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      import('@vapi-ai/web').then(({ default: Vapi }) => {
        vapiRef.current = new Vapi(
          process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY!
        )
        vapiRef.current.on('call-start', () => setCallActive(true))
        vapiRef.current.on('call-end', () => {
          setCallActive(false)
          setLoading(false)
        })
        vapiRef.current.on('error', () => {
          setCallActive(false)
          setLoading(false)
        })
      })
    }
    return () => { vapiRef.current?.stop() }
  }, [])

  async function startNegotiation(
    vendorName: string,
    targetBudget: string,
    contractDuration: string,
    companyName: string = 'our organization'
  ) {
    if (!vapiRef.current) return
    setLoading(true)
    try {
      await vapiRef.current.start(
        process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID!,
        {
          firstMessage: `Hello, this is Sarah calling on behalf of ${companyName}. I'm reaching out regarding our evaluation of ${vendorName}. We're very interested but our procurement constraints require us to stay within ${targetBudget} per month for a ${contractDuration} contract. Are you able to work with us on the pricing?`,
          assistantOverrides: {
            variableValues: {
              vendor_name: vendorName,
              target_budget: targetBudget,
              contract_duration: contractDuration,
              company_name: companyName,
            }
          }
        }
      )
    } catch {
      setLoading(false)
    }
  }

  function stopNegotiation() {
    vapiRef.current?.stop()
  }

  return { callActive, loading, startNegotiation, stopNegotiation }
}
