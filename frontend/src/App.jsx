import { useState } from 'react'
import axios from 'axios'
import './App.css'

function App() {
  const [response, setResponse] = useState("Click a button to test an API...")
  
  // The base URL points to your Kong API Gateway
  const KONG_URL = 'http://localhost:8000'

  // 1. Test Get Recommendation
  const testRecommendation = async () => {
    try {
      setResponse("Loading recommendations...")
      // Update the URL path to match your kong.yml route
      const res = await axios.get(`${KONG_URL}/recommend`) 
      setResponse(JSON.stringify(res.data, null, 2))
    } catch (error) {
      setResponse(error.message + "\n\n(Check if the route exists in kong.yml)")
    }
  }

  // 2. Test Place Order
  const testPlaceOrder = async () => {
    try {
      setResponse("Placing order...")
      const res = await axios.post(`${KONG_URL}/place-order`, {
        itemId: "123",
        quantity: 2
      })
      setResponse(JSON.stringify(res.data, null, 2))
    } catch (error) {
      setResponse(error.message)
    }
  }

  // 3. Test Checkout
  const testCheckout = async () => {
    try {
      setResponse("Processing checkout...")
      const res = await axios.post(`${KONG_URL}/checkout`, {
        orderId: "ord_999",
        paymentMethod: "credit_card"
      })
      setResponse(JSON.stringify(res.data, null, 2))
    } catch (error) {
      setResponse(error.message)
    }
  }

  // 4. Test Expiry Food
  const testExpiry = async () => {
    try {
      setResponse("Removing expired food...")
      const res = await axios.delete(`${KONG_URL}/expiry`)
      setResponse(JSON.stringify(res.data, null, 2))
    } catch (error) {
      setResponse(error.message)
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>FoodRescue Orchestrator Testing</h1>
      
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <button onClick={testRecommendation}>Get Recommendation</button>
        <button onClick={testPlaceOrder}>Place Order</button>
        <button onClick={testCheckout}>Proceed to Checkout</button>
        <button onClick={testExpiry}>Remove Expired Food</button>
      </div>

      <h2>API Response:</h2>
      <pre style={{ 
        backgroundColor: '#f4f4f4', 
        color: 'black',
        padding: '15px', 
        borderRadius: '5px',
        minHeight: '100px',
        whiteSpace: 'pre-wrap'
      }}>
        {response}
      </pre>
    </div>
  )
}

export default App