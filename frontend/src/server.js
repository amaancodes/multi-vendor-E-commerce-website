console.log('Current NODE_ENV:', process.env.NODE_ENV);

export const server = process.env.NODE_ENV === 'production'
    ? "https://dp-backend-kappa.vercel.app/api/v2"
    : "http://localhost:8000/api/v2";

export const backend_url = process.env.NODE_ENV === 'production'
    ? "https://dp-backend-kappa.vercel.app/"
    : "http://localhost:8000/";


 