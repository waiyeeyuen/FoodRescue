import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function InventoryPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [response, setResponse] = useState([]);
  const [form, setForm] = useState({ name: '', quantity: '', supplier: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', quantity: '', supplier: '' });

  const inventoryUrl = "http://localhost:3000";

  // Get all inventory items on page load
  useEffect(() => {
    getInventory();
  }, []);

  // Get all inventory items
  const getInventory = async () => {
    try {
      const res = await fetch(`${inventoryUrl}/inventory`);
      const data = await res.json();
      setResponse(data); // Update state with fetched inventory
    } catch (err) {
      console.error(err.message);
    }
  };

  // Update form state when input changes
  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value }); // Spread existing form values and override the changed field
  };

  // Post a new inventory item
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true); // Disable button while submitting to prevent multiple clicks
    setError(null); // Clear previous errors
    try {
      const res = await fetch(`${inventoryUrl}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          quantity: Number(form.quantity),
          supplier: form.supplier,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to add item');
      }
      setForm({ name: '', quantity: '', supplier: '' }); // Clear form after successful submission
      await getInventory(); // Refresh inventory list to show the new item
    } catch (err) {
      setError(err.message); // Show error message to user
    } finally {
      setSubmitting(false); // Re-enable button after submission is complete
    }
  };

  // Delete an inventory item
  const handleDelete = async (id) => {
    if (!confirm('Delete this item?')) return; // Ask for confirmation before deleting
    try {
      await fetch(`${inventoryUrl}/inventory/${id}`, { method: 'DELETE' });
      await getInventory(); // Refresh inventory list to reflect the deletion
    } catch (err) {
      alert(err.message); // Show error message to user
    }
  };

  // Start editing an inventory item
  const startEdit = (item) => {
    setEditingId(item.id); // Track which item is being edited
    setEditForm({ name: item.name, quantity: item.quantity, supplier: item.supplier }); // Pre-fill edit form with current values
  };

  // Cancel editing and reset the edit form
  const cancelEdit = () => {
    setEditingId(null); // Clear the editing state
    setEditForm({ name: '', quantity: '', supplier: '' }); // Reset edit form fields
  };

  // Update an inventory item
  const handleUpdate = async (id) => {
    try {
      const res = await fetch(`${inventoryUrl}/inventory/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          quantity: Number(editForm.quantity), // Convert to number to match expected type
          supplier: editForm.supplier,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update item');
      }
      cancelEdit(); // Exit edit mode after successful update
      await getInventory(); // Refresh inventory list to show the updated item
    } catch (err) {
      alert(err.message); // Show error message to user
    }
  };

  // Logout and redirect to login page
  const handleLogout = () => {
    logout();
    navigate('/auth');
  };

  return (
    <div className='text-lg flex flex-col gap-6 p-6'>
      <div className='flex justify-between items-center'>
        <div className='flex items-center gap-4'>
          <button
            onClick={() => navigate('/')}
            className='text-blue-500 hover:underline text-sm'
          >← Home</button>
          <h1 className='text-2xl font-bold'>Inventory</h1>
        </div>
        <button
          onClick={handleLogout}
          className='bg-gray-200 px-3 py-1 rounded text-sm hover:bg-gray-300'
        >Logout</button>
      </div>

      <form onSubmit={handleSubmit} className='flex flex-col gap-3 max-w-sm'>
        <h2 className='font-bold text-xl'>Add Inventory Item</h2>
        <input
          name='name'
          value={form.name}
          onChange={handleChange}
          placeholder='Name'
          required
          className='border p-2 rounded'
        />
        <input
          name='quantity'
          value={form.quantity}
          onChange={handleChange}
          placeholder='Quantity'
          type='number'
          required
          className='border p-2 rounded'
        />
        <input
          name='supplier'
          value={form.supplier}
          onChange={handleChange}
          placeholder='Supplier'
          required
          className='border p-2 rounded'
        />
        {error && <p className='text-red-500 text-sm'>{error}</p>}
        <button
          type='submit'
          disabled={submitting}
          className='bg-blue-500 text-white p-2 rounded hover:bg-blue-600 disabled:opacity-50'
        >
          {submitting ? 'Adding...' : 'Add Item'}
        </button>
      </form>

      <div className='flex flex-col gap-3'>
        <h2 className='font-bold text-xl'>Items</h2>
        {response.map((item) => (
          <div key={item.id} className='flex gap-4 items-center'>
            {editingId === item.id ? (
              <>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className='border p-1 rounded w-32'
                />
                <input
                  value={editForm.quantity}
                  onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })}
                  type='number'
                  className='border p-1 rounded w-20'
                />
                <input
                  value={editForm.supplier}
                  onChange={(e) => setEditForm({ ...editForm, supplier: e.target.value })}
                  className='border p-1 rounded w-32'
                />
                <button onClick={() => handleUpdate(item.id)} className='bg-green-500 text-white px-2 py-1 rounded text-sm hover:bg-green-600'>Save</button>
                <button onClick={cancelEdit} className='bg-gray-400 text-white px-2 py-1 rounded text-sm hover:bg-gray-500'>Cancel</button>
              </>
            ) : (
              <>
                <span className='w-32'>{item.name}</span>
                <span className='w-20'>{item.quantity}</span>
                <span className='w-32'>{item.supplier}</span>
                <button onClick={() => startEdit(item)} className='bg-yellow-400 text-white px-2 py-1 rounded text-sm hover:bg-yellow-500'>Edit</button>
                <button onClick={() => handleDelete(item.id)} className='bg-red-500 text-white px-2 py-1 rounded text-sm hover:bg-red-600'>Delete</button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default InventoryPage;
