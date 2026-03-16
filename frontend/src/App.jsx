import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [response, setResponse] = useState([]);

  const url = "http://localhost:3000"

  useEffect(() => {
    const getInventory = async () => {
      try {
        const res = await fetch(`${url}/inventory`)
        const data = await res.json()
        setResponse(data)
      } catch (error) {
        throw error.message
      }
    }

    getInventory()
  }, []);

  return (
    <div className='text-lg flex flex-col gap-3'>
      {response.map((res) => (
        <div className='flex gap-4'>
          <span>{res.name}</span>
          <span>{res.quantity}</span>
          <span>{res.supplier}</span>
        </div>
      ))}
    </div>
  )
}

export default App