// trading_bars.js
import { Midi } from '@tonejs/midi';
import * as converter from './compound_converter.ts';

class MusicTrader {
  constructor(chat, midiLoader) {
    this.chat = chat;
    this.midiLoader = midiLoader;
    this.isTrading = false;
    this.barsPerTrade = 8;
    this.currentTrader = 'human'; // 'human' 或 'ai'
    this.tradingStyle = 'mimic';
    this.tradingSession = [];
    this.ticksPerBar = 1920; // 默认值，将从MIDI中计算
    this.lastBarEndTime = 0;
    
    // 初始化时不调用calculateTicksPerBar，等待有数据时再调用
  }
  
  async calculateTicksPerBar() {
    // 获取当前MIDI数据
    const midiDataUrl = this.midiLoader.getMIDIData();
    if (!midiDataUrl) {
      console.log("No MIDI data available for tick calculation");
      return;
    }
    
    try {
      // 从data URI中获取MIDI数据
      const response = await fetch(midiDataUrl);
      const blob = await response.blob();
      const midi = await Midi.fromUrl(URL.createObjectURL(blob));
      
      // 从MIDI头获取时间签名和PPQ（每四分音符的tick数）
      const timeSignature = midi.header.timeSignatures[0] || { timeSignature: [4, 4] };
      const ticksPerBeat = midi.header.ppq;
      this.ticksPerBar = ticksPerBeat * timeSignature.timeSignature[0];
      console.log(`Successfully calculated ticks per bar: ${this.ticksPerBar}`);
      
      return midi;
    } catch (error) {
      console.error("Error calculating ticks per bar:", error);
      this.ticksPerBar = 1920; // 默认值 (480 ticks/beat * 4 beats)
      return null;
    }
  }
  
  async startTradingSession() {
    this.isTrading = true;
    this.tradingSession = [];
    this.currentTrader = 'human';
    this.lastBarEndTime = 0;
    
    // 如果已经有MIDI数据，将其视为第一个人类部分
    const midiDataUrl = this.midiLoader.getMIDIData();
    if (midiDataUrl) {
      document.getElementById('tradingStatus').textContent = 'Analyzing MIDI data...';
      
      try {
        // 计算每小节的tick数，并获取MIDI对象
        const midi = await this.calculateTicksPerBar();
        if (!midi) {
          document.getElementById('tradingStatus').textContent = 
            'Error analyzing MIDI. Using default settings.';
          return;
        }
        
        // 找到最后一个音符的结束时间
        let lastTime = 0;
        midi.tracks.forEach(track => {
          track.notes.forEach(note => {
            lastTime = Math.max(lastTime, note.ticks + note.durationTicks);
          });
        });
        
        // 将结束时间调整到小节边界
        const barCount = Math.ceil(lastTime / this.ticksPerBar);
        this.lastBarEndTime = barCount * this.ticksPerBar;
        
        // 将初始的人类部分添加到交易会话
        this.tradingSession.push({
          trader: 'human',
          startTime: 0,
          endTime: this.lastBarEndTime,
          barCount: barCount,
          midiData: midiDataUrl,
          compounds: this.midiLoader.currCompounds,
          time: this.midiLoader.currTime
        });
        
        document.getElementById('tradingStatus').textContent = 
          `Human part recorded (${barCount} bars). Ready for AI turn.`;
        document.getElementById('generateAIPartButton').disabled = false;
        document.getElementById('addHumanPartButton').disabled = true;
        
      } catch (error) {
        console.error("Error analyzing MIDI for trading:", error);
        document.getElementById('tradingStatus').textContent = 
          'Error analyzing MIDI. Try uploading a different file.';
      }
    } else {
      document.getElementById('tradingStatus').textContent = 
        'No MIDI data. Please upload or record your part first.';
      document.getElementById('addHumanPartButton').disabled = false;
      document.getElementById('generateAIPartButton').disabled = true;
    }
  }
  
  async generateAIPart() {
    if (!this.isTrading) return;
    
    const barsPerTrade = parseInt(document.getElementById('barsPerTrade').value);
    const tradingStyle = document.getElementById('tradingStyle').value;
      // 获取当前生成配置

    document.getElementById('tradingStatus').textContent = 'AI is generating...';
    this.currentTrader = 'ai';
    
    // 根据选择的风格设置交易风格参数
    this.setTradingStyleParameters(tradingStyle);
    
    try {
      // 记住当前的状态
      const currentTime = this.midiLoader.currTime;
      const currentCompounds = [...this.midiLoader.currCompounds];
      const temperature = parseFloat(document.getElementById("temperature-value").innerHTML);
      const top_p = parseFloat(document.getElementById("topP-value").innerHTML);
      const frequency_penalty = parseFloat(document.getElementById("frequencyPenalty-value").innerHTML);
    // 根据读取的值，设置全局生成参数
      window.genConfig = {
            temperature: temperature,
            top_p: top_p,
            frequency_penalty: frequency_penalty
       };
      // 生成新内容
      const generatedTokensStr = await this.chat.chunkGenerate();
      const generatedTokens = generatedTokensStr.split(',').map(t => parseInt(t));
      console.log("Generated tokens:", generatedTokens.length);

      // 先添加令牌到MIDILoader
      this.midiLoader.addEventTokens(generatedTokens);
      console.log("Added tokens to MIDILoader");
    
    // 然后获取更新后的MIDI数据
      const newMidiDataUrl = this.midiLoader.getMIDIData();
      console.log("Got new MIDI data URL, length:", newMidiDataUrl.length);
      console.log("Updating MIDI player with new data...");
      if (typeof window.update_midi === 'function') {
            await window.update_midi(newMidiDataUrl);
            console.log("Called window.update_midi successfully");
          } else {
            console.error("window.update_midi is not a function!");
          }
      // 计算新生成内容的小节数
      const barsDuration = barsPerTrade * this.ticksPerBar;
      
      // 将AI部分添加到交易会话
      this.tradingSession.push({
        trader: 'ai',
        startTime: this.lastBarEndTime,
        endTime: this.lastBarEndTime + barsDuration,
        barCount: barsPerTrade,
        midiData: newMidiDataUrl,
        tokens: generatedTokens,
        compounds: this.midiLoader.currCompounds,
        time: this.midiLoader.currTime
      });
      
      // 更新最后的小节结束时间
      this.lastBarEndTime += barsDuration;
      
      // 更新UI
      document.getElementById('tradingStatus').textContent = 
        `AI part generated (${barsPerTrade} bars). ${this.tradingSession.length} parts in session.`;
      document.getElementById('generateAIPartButton').disabled = true;
      document.getElementById('addHumanPartButton').disabled = false;
      
      // 更新MIDI播放器
      await window.update_midi(newMidiDataUrl);
      
      // 切换交易者
      this.currentTrader = 'human';
    } catch (error) {
      console.error("Error generating AI part:", error);
      document.getElementById('tradingStatus').textContent = 'Error generating AI part.';
    }
  }
  
  async addHumanPart() {
    // 触发文件上传
    document.getElementById('tradingStatus').textContent = 'Upload your MIDI response...';
    document.getElementById('midiFile').click();
  }
  
  async processHumanMidiUpload(file) {
    if (!this.isTrading) return;
    
    try {
      // 保存当前状态
      const prevMidiData = this.midiLoader.getMIDIData();
      const prevCompounds = [...this.midiLoader.currCompounds];
      const prevTime = this.midiLoader.currTime;
      
      // 加载新的MIDI文件
      const tokens = await window.loadMidiTokens(file);
      
      // 从URL获取并解析MIDI
      const midi = await Midi.fromUrl(URL.createObjectURL(file));
      
      // 计算小节数
      let lastTime = 0;
      midi.tracks.forEach(track => {
        track.notes.forEach(note => {
          lastTime = Math.max(lastTime, note.ticks + note.durationTicks);
        });
      });
      
      const barCount = Math.ceil(lastTime / this.ticksPerBar);
      
      // 添加到交易会话
      this.tradingSession.push({
        trader: 'human',
        startTime: this.lastBarEndTime,
        endTime: this.lastBarEndTime + barCount * this.ticksPerBar,
        barCount: barCount,
        midiData: this.midiLoader.getMIDIData(),
        tokens: tokens,
        compounds: this.midiLoader.currCompounds,
        time: this.midiLoader.currTime
      });
      
      // 更新最后的小节结束时间
      this.lastBarEndTime += barCount * this.ticksPerBar;
      
      // 更新UI
      document.getElementById('tradingStatus').textContent = 
        `Human part added (${barCount} bars). ${this.tradingSession.length} parts in session.`;
      document.getElementById('generateAIPartButton').disabled = false;
      document.getElementById('addHumanPartButton').disabled = true;
      
      // 切换交易者
      this.currentTrader = 'ai';
    } catch (error) {
      console.error("Error processing human MIDI:", error);
      document.getElementById('tradingStatus').textContent = 'Error processing your MIDI.';
    }
  }
  
  setTradingStyleParameters(style) {
    // 根据交易风格调整生成参数
    const temperature = document.getElementById("temperature");
    const topP = document.getElementById("topP");
    const frequencyPenalty = document.getElementById("frequencyPenalty");
    const ensembleDensity = document.getElementById("ensembleDensity");
    
    switch(style) {
      case 'mimic':
        // 较低的温度以更忠实地模仿
        temperature.value = "0.7";
        topP.value = "0.9";
        frequencyPenalty.value = "0.2";
        // 保持类似的密度
        ensembleDensity.value = document.getElementById("ensembleDensity-value").innerHTML;
        break;
        
      case 'contrast':
        // 较高的温度以增加变化
        temperature.value = "1.2";
        topP.value = "1.0";
        frequencyPenalty.value = "1.0";
        // 改变密度以形成对比
        const currentDensity = parseFloat(document.getElementById("ensembleDensity-value").innerHTML);
        ensembleDensity.value = Math.min(Math.max(0, 1.0 - currentDensity), 1.0).toString();
        break;
        
      case 'develop':
        // 平衡的参数以进行主题发展
        temperature.value = "0.9";
        topP.value = "0.9";
        frequencyPenalty.value = "0.5";
        // 稍微增加密度以便发展
        const density = parseFloat(document.getElementById("ensembleDensity-value").innerHTML);
        ensembleDensity.value = Math.min(density + 0.2, 1.0).toString();
        break;
    }
    
    // 触发输入事件以更新显示值
    temperature.dispatchEvent(new Event('input'));
    topP.dispatchEvent(new Event('input'));
    frequencyPenalty.dispatchEvent(new Event('input'));
    ensembleDensity.dispatchEvent(new Event('input'));
  }
}

// 导出初始化函数
export async function initTradingFeature(chat, midi_loader) {
  // 创建trader实例
  const trader = new MusicTrader(chat, midi_loader);
  
  // 设置事件监听器
  document.getElementById('startTradingButton').addEventListener('click', () => {
    trader.startTradingSession();
  });
  
  document.getElementById('generateAIPartButton').addEventListener('click', async () => {
    await trader.generateAIPart();
  });
  
  document.getElementById('addHumanPartButton').addEventListener('click', () => {
    trader.addHumanPart();
  });
  
  // 修改现有的midiFile更改监听器以配合交易
  const fileInput = document.getElementById('midiFile');
  if (fileInput) {
    const originalChangeListener = fileInput.onchange;
    
    fileInput.onchange = async (e) => {
      if (e.target === null || e.target.files === null || e.target.files.length === 0) {
        return;
      }
      
      if (trader.isTrading && trader.currentTrader === 'human') {
        // 作为交易会话的一部分处理
        await trader.processHumanMidiUpload(e.target.files[0]);
      } else {
        // 对于非交易场景使用原始功能
        if (originalChangeListener) {
          originalChangeListener(e);
        }
      }
    };
  }
  
  // 启用/禁用交易模式切换
  document.getElementById('enableTrading').addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    document.getElementById('startTradingButton').disabled = !isEnabled;
    if (!isEnabled) {
      trader.isTrading = false;
      document.getElementById('addHumanPartButton').disabled = true;
      document.getElementById('generateAIPartButton').disabled = true;
      document.getElementById('tradingStatus').textContent = 'Trading mode disabled';
    } else {
      document.getElementById('tradingStatus').textContent = 'Ready to start trading session';
    }
  });
  
  return trader;
}