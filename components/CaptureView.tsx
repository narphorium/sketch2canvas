import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import styles from './CaptureView.module.css';

interface CaptureViewProps {
  
}

export const CaptureView = ({  }: CaptureViewProps) => {
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [imageSrc, setImageSrc] = useState('');
  const [cameraIndex, setCameraIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImageSrc(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const requestCameraPermission = async () => {
    try {
      setStatusMessage('Requesting camera permission...');
      const permission = await navigator.permissions.query({ name: 'camera' as PermissionName });

      if (permission.state === 'granted') {
        startWebcam();
      } else if (permission.state === 'prompt') {
        setStatusMessage('Please grant camera permission in the browser prompt.');
        startWebcam();
      } else {
        throw new Error('Camera permission denied');
      }
    } catch (err: any) {
      handleWebcamError(err);
    }
  };

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      setStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setErrorMessage('');
      setStatusMessage('Webcam started successfully!');
    } catch (err: any) {
      handleWebcamError(err);
    }
  };

  const handleWebcamError = (err: Error) => {
    console.error('Error accessing the webcam:', err);
    let errorMsg = `Error: ${err.message}. `;
    if (err.name === 'NotFoundError') {
      errorMsg += 'No camera found. Please ensure your device has a webcam.';
    } else if (err.name === 'NotAllowedError') {
      errorMsg += 'Camera access denied. Please grant permission in your browser settings.';
    } else {
      errorMsg += "Please ensure your device has a webcam and you've granted permission to use it.";
    }
    setErrorMessage(errorMsg);
    setStatusMessage('');
  };

  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        setImageSrc(canvas.toDataURL('image/png'));
        stopWebcam();
      }
    }
  };

  const stopWebcam = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
      setStatusMessage('');
    }
  };

  const submitRequest = async () => {
    if (stream) {
      stopWebcam();
    }
    setImageSrc('');
    
    if (canvasRef.current) {
      try {
        const imageData = canvasRef.current.toDataURL('image/png');
        await axios.post('/canvas', { imageData });
        alert('Data saved successfully');
      } catch (error) {
        console.error('Error saving data:', error);
        alert('Error saving data');
      }
    }
  };

  const processImage = () => {
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const image = new Image();
        image.onload = () => {
          canvas.width = image.width;
          canvas.height = image.height;
          ctx.drawImage(image, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            data[i] = avg; // red
            data[i + 1] = avg; // green
            data[i + 2] = avg; // blue
          }
          ctx.putImageData(imageData, 0, 0);
          setImageSrc(canvas.toDataURL('image/png'));
        };
        image.src = imageSrc;
      }
    }
  };

  return (
    <div className={styles.container}>
      <h1>Image Processor</h1>
      <input type="file" ref={fileInputRef} accept="image/*" onChange={handleFileInputChange} />
      <button onClick={requestCameraPermission}>Use Webcam</button>
      <button onClick={captureImage} className={stream ? styles.visible : styles.hidden}>
        Capture Image
      </button>
      <button onClick={submitRequest}>Submit</button>

      <div className={styles.statusMessage}>{statusMessage}</div>
      <div className={styles.errorMessage}>{errorMessage}</div>
      <div className={styles.videoContainer}>
        <video ref={videoRef} width="100%" autoPlay className={stream ? styles.visible : styles.hidden}></video>
      </div>
      <div className={styles.imageContainer}>
        <img
          src={imageSrc}
          alt="Processed Image"
          className={styles.image}
          onLoad={processImage}
        />
      </div>
      <canvas ref={canvasRef} className={styles.canvas}></canvas>
    </div>
  );
};

export default CaptureView;