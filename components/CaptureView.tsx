import React, { useState, useRef, useEffect, use } from 'react';
import styles from './CaptureView.module.css';
import usePersistantState from './usePersistantState';


export const CaptureView = () => {
  const [status, setStatus] = useState<'running' | 'success' | 'error' | ''>('');
  const [statusMessage, setStatusMessage] = useState('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [imageSrc, setImageSrc] = useState('');
  const [buffer, setBuffer] = useState('');
  const [settingsVisible, setSettingsVisible] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [variablePattern, setVariablePattern] = usePersistantState<string>('settings.variablePattern', '$VAR');
  const [cannoliMode, setCannoliMode] = usePersistantState<boolean>('settings.cannoliMode', false);
  const [metaprompting, setMetaprompting] = usePersistantState<boolean>('settings.metaprompting', false);
  const [outputFilename, setOutputFilename] = useState('my_canvas');

  useEffect(() => {
    const lines = buffer.trim().split('\n');
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1].trim();
      if (lastLine.endsWith('}')) {
        const chunk = JSON.parse(lastLine);
        setStatus(chunk.status);
        setStatusMessage(chunk.message);
      }
    }
  }, [buffer]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const p = file.name.split('.')
        if (p.length > 1) {
          setOutputFilename(p[p.length - 2])
        }
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
        videoRef.current.play();
      }
      // setStatusMessage('Webcam started successfully!');
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
    setStatusMessage(errorMsg);
    setStatus('error');
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
        setStatusMessage('');
        setStatus('');
        stopWebcam();
      }
    }
  };

  const resetImage = (e: any) => {
    setImageSrc('');
    setStatusMessage('');
    setStatus('');
    setSettingsVisible(false);
    e.stopPropagation();
  }

  const clickImageMode = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const stopWebcam = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
      setStatusMessage('');
    }
  };

  const submitRequest = async (e: any) => {
    e.stopPropagation();
    if (canvasRef.current) {
      let name = outputFilename;
      const imageData = canvasRef.current.toDataURL('image/png');
      const response = await fetch('/canvas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          imageData, 
          name,
          variablePattern,
          metaprompting,
          mode: cannoliMode ? 'cannoli' : 'default'
        })
      });

      if (response.body !== null) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        setBuffer('');
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          setBuffer((prevText) => prevText + chunk);
        }
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
          ctx.putImageData(imageData, 0, 0);
          setImageSrc(canvas.toDataURL('image/png'));
        };
        image.src = imageSrc;
      }
    }
  };

  const toggleSettings = () => {
    setSettingsVisible((prevVisible) => !prevVisible);
  }


  return (
    <div className={styles.container}>

        <div className={styles.modeContainer + ' ' + (stream || imageSrc ? styles.hidden : styles.visible)}>
          <div>
            <button onClick={requestCameraPermission} className={styles.modeButton}><img src="/camera.svg"/><br/>Use Webcam</button>
            <button onClick={clickImageMode} className={styles.modeButton}><img src="/folder.svg"/><br/>Use Image</button>
          </div>
          <input type="file" ref={fileInputRef} accept="image/*" onChange={handleFileInputChange} />
        </div>
        <div className={styles.videoContainer + ' ' + (stream ? styles.visible : styles.hidden)}>
          <video ref={videoRef} width="100%" autoPlay className={styles.stream + ' ' + (stream ? styles.visible : styles.hidden)}></video>
          <div className={styles.controlsContainer}>
            <button onClick={stopWebcam} className={styles.buttonStart}>Cancel</button>
            <button onClick={captureImage} className={styles.primaryButton + ' ' + styles.buttonEnd}>Capture Image</button>
          </div>
        </div>
        <div className={styles.submitContainer + ' ' + (imageSrc ? styles.visible : styles.hidden)}>
          <img
            src={imageSrc}
            alt="Processed Image"
            className={styles.image + ' ' + (imageSrc ? styles.visible : styles.hidden)}
            onLoad={processImage}
          />
          <canvas ref={canvasRef} className={styles.canvas + ' ' + (stream ? styles.hidden : styles.visible)}></canvas>
          <div className={styles.controlsContainer}>
            <label>Name:</label><input type="text" defaultValue={outputFilename} onChange={(e) => setOutputFilename(e.target.value)} />
            <button onClick={resetImage} className={styles.buttonStart}>Restart</button>
            <button onClick={submitRequest} className={styles.primaryButton + ' ' + styles.buttonEnd}>Generate</button>
            <button onClick={toggleSettings} className={styles.settingsButton}></button>
            <div className={styles.settingsMenu + ' ' + (settingsVisible ? styles.visible : styles.hidden)}>
              <h3>Settings</h3>
              <div className={styles.settingsGrid}>
                <label>Variable pattern</label>
                <input type="text" defaultValue={variablePattern} onChange={(e) => setVariablePattern(e.target.value)} />
                <label>Use <a href="https://github.com/DeabLabs/cannoli" target="_blank">Cannoli</a> format</label>
                <input type="checkbox" defaultChecked={cannoliMode} onChange={(e) => setCannoliMode(e.target.checked)}/>
                <label>Enable metaprompting</label>
                <input type="checkbox" defaultChecked={metaprompting} onChange={(e) => setMetaprompting(e.target.checked)}/>
              </div>
            </div>
          </div>
          <div className={styles.statusMessage + ' ' + styles[status]}><span className={styles.loader}></span>{statusMessage}</div>
        </div>
    </div>
  );
};

export default CaptureView;