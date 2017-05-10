import Ember from 'ember';
import Service from 'ember-service';
import service from 'ember-service/inject';
import computed from 'ember-computed';
import get from 'ember-metal/get';
import set from 'ember-metal/set';
import { bind } from 'ember-runloop';
import { classify as upperCamelize } from 'ember-string';

const TWO_MINUTES     = 1000 * 60 * 2;

export default Service.extend({
  hifi        : service(),
  dataPipeline: service(),
  metrics     : service(),
  poll        : service(),
  bumperState : service(),
  currentSound: computed.reads('hifi.currentSound'),
  sessionPing : TWO_MINUTES,

  init() {
    this.listenForTrackChanges();

    get(this, 'poll').addPoll({
      interval: get(this, 'sessionPing'),
      callback: bind(this, this._onPlayerPing),
      label: 'playerPing'
    });

    Ember.$(window).on('beforeunload', () => {
      if (this.get('currentSound.metadata.contentModel')) {
        this._sendListenAction(this.get('currentSound.metadata.contentModel'), 'close');
      }
    });

    get(this, 'hifi').on('audio-played', bind(this, this._onAudioPlayed));
    get(this, 'hifi').on('audio-paused', bind(this, this._onAudioPaused));
    get(this, 'hifi').on('audio-ended',  bind(this, this._onAudioEnded));

    this._super(...arguments);
  },

  /* Monitoring hifi events and then logging analytics -------------------------
    ---------------------------------------------------------------------------*/

  listenForTrackChanges() {
    let audioEndedSound, audioPausedSound;

    get(this, 'hifi').on('audio-ended', (sound) => (audioEndedSound = sound));
    get(this, 'hifi').on('audio-paused', (sound) => {
      sound.one('audio-played', () => (audioPausedSound = null));
      audioPausedSound = sound;
    });

    get(this, 'hifi').on('current-sound-changed', (currentSound, previousSound) => {
      let currentType     = currentSound.get('metadata.contentModelType');
      let currentContext  = currentSound.get('metadata.playContext');

      let previousContext, previousStory, previousType;
      if (previousSound) {
        previousContext = previousSound.get('metadata.playContext');
        previousType    = previousSound.get('metadata.contentModelType');
        previousStory   = previousSound.get('metadata.contentModel');
      }

      if (previousSound && previousSound !== audioEndedSound && previousSound !== audioPausedSound) {
        this._onDemandInterrupted(previousSound);
      }

      if (previousType === 'stream' && currentType === 'stream') {
        this._onStreamSwitch(previousSound, currentSound);
      }
      else if (previousType === 'bumper' && currentContext === 'queue') {
        this._onQueueAutoplay();
      }
    });
  },

  /* Internal actions for logging events. Don't call these from the outside
    ----------------------------------------------------------------------------------*/

  _onAudioPlayed(sound) {
    let type = get(sound, 'metadata.contentModelType');

    if (type === 'story') { // on demand
      this._onDemandPlay(sound);
    }
    else if (type === 'stream') {
      this._onStreamPlay(sound);
    }
    else if (type === 'bumper') {
      this._onBumperPlay(sound);
    }
  },

  _onAudioEnded(sound) {
    let story = get(sound, 'metadata.contentModel');
    let playContext = get(sound, 'metadata.playContext');

    this.__trackPlayerEvent({
      story,
      action: 'Finished Story',
      withRegion: true,
      region: upperCamelize(playContext)
    });

    this._sendListenAction(story, 'finish');
  },

  _onAudioPaused(sound) {
    let type = get(sound, 'metadata.contentModelType');

    if (type === 'bumper') {
      this._onBumperPause(sound);
    }
    else if (type === 'stream') {
      this._onStreamPause(sound);
    }
    else if (type === 'story') {
      this._onDemandPause(sound);
    }
  },

  _onDemandPlay(sound) {
    let action      = get(sound, 'position') === 0 ? 'start' : 'resume';
    let story       = get(sound, 'metadata.contentModel');
    let playContext = get(sound, 'metadata.playContext');

    this._sendListenAction(story, action);
    this._trackPlayerEvent({
      action: `Played Story "${story.get('title')}"`,
      withRegion: true,
      region: upperCamelize(playContext),
      withAnalytics: true,
      story
    });
    this._trackPlayerEventForNpr({
      category: 'Engagement',
      action: 'On_demand_audio_play',
      label: get(story, 'audio')
    });

    if (playContext === 'queue' || playContext === 'history') {
      this._trackPlayerEvent({
        action: 'Played Story from Queue',
        label: story.get('title'),
        story
      });
    }
  },

  _onDemandPause(sound) {
    let story       = get(sound, 'metadata.contentModel');
    let playContext = get(sound, 'metadata.playContext');

    this._trackPlayerEvent({
      story: story,
      action: 'Pause',
      withRegion: true,
      region: this._formatContext(playContext),
    });

    this._trackPlayerEventForNpr({
      category: 'Engagement',
      action: 'On_demand_audio_pause',
      label: get(story, 'audio')
    });

    this._sendListenAction(story, 'pause');
  },

  _onDemandInterrupted(sound) {
    let story = get(sound, 'metadata.contentModel');
    this._sendListenAction(story, 'interrupt');
  },

  _onStreamPlay(sound) {
    let stream      = get(sound, 'metadata.contentModel');
    let playContext = get(sound, 'metadata.playContext');
    let streamName  = get(stream, 'name');

    let label = streamName;
    if (playContext === 'nav' || playContext === 'Continuous Play') {
      label += `|${this._formatContext(playContext)}`;
    }

    this._trackPlayerEvent({
      action: 'Launched Stream',
      label,
    });

    this._sendListenAction(stream, 'start');

    this._trackPlayerEventForNpr({
      category: 'Engagement',
      action: 'Stream_Play',
      label: `Streaming_${streamName}`
    });
  },

  _onStreamSwitch(previousSound, currentSound) {
    let previousStream = previousSound.get('metadata.contentModel');
    let currentStream  = currentSound.get('metadata.contentModel');
    let prevStreamName = get(previousStream, 'name');
    let currentStreamName = get(currentStream, 'name');

    this._trackPlayerEvent({
      action: 'Switched Stream to Stream',
      label: `from ${prevStreamName} to ${currentStreamName}`
    });

    this._trackPlayerEventForNpr({
      category: 'Engagement',
      action: 'Stream_Change',
      label: `Streaming_${currentStreamName}`
    });
  },

  _onStreamPause(sound) {
    let stream      = get(sound, 'metadata.contentModel');
    let playContext = get(sound, 'metadata.playContext');

    this._trackPlayerEvent({
      story: stream,
      action: 'Pause',
      withRegion: true,
      region: this._formatContext(playContext),
    });

    this._trackPlayerEventForNpr({
      category: 'Engagement',
      action: 'Stream_Pause',
      label: `Streaming_${get(stream, 'name')}`
    });

    this._sendListenAction(stream, 'pause');
  },

  _onBumperPause(sound) {
    let bumper = get(sound, 'metadata.contentModel');
    let bumperSetting = get(this, 'bumperState.autoplayChoice');

    this._trackPlayerEvent({
      action: 'Paused Bumper',
      label: `${bumperSetting}|Continuous Play`
    });

    this._sendListenAction(bumper, 'pause');
  },

  _onBumperPlay() {
    this._trackPlayerEvent({
      action: 'Continuous Play Notification',
      label: 'Audio Bumper',
    });
  },

  _onQueueAutoplay() {
    this._trackPlayerEvent({
      action: 'Launched Queue',
      label: 'Continuous Play'
    });
  },

  _onPlayerPing() {
    get(this, 'metrics').trackEvent('GoogleAnalytics', {
      category: 'Persistent Player',
      action: '2 Minute Ping',
      value: get(this, 'hifi.isPlaying') ? 1 : 0
    });
  },


  /*  Called externally -------------------------------------------------------
    --------------------------------------------------------------------------*/

  trackAllCodecFailures(failures, sound) {
    if (failures && failures.length) {
      failures.forEach(failed => this._trackCodecFailure(failed, sound));
    }
  },

  trackSoundFailure({message, failures}) {
    this._trackPlayerEvent({
      action: 'Sound Error',
      label: message
    });
    if (failures && failures.length) {
      failures.forEach(failed => this.trackCodecFailure(failed));
    }
  },

  trackDismissAutoplayNotification() {
    this._trackPlayerEvent({
      action: 'Continuous Play Notification',
      label: 'Click to Close Notification'
    });
  },

  trackAddToQueue(story, region) {
    this._trackPlayerEvent({
      action: 'Add Story to Queue',
      withRegion: true,
      region,
      withAnalytics: true,
      story
    });
  },

  trackPositionChange(sound) {
    let story = get(sound, 'metadata.contentModel');
    this._sendListenAction(story, 'position');
  },

  trackRewind(sound) {
    let story = get(sound, 'metadata.contentModel');
    this._sendListenAction(story, 'back_15');

    this._trackPlayerEvent({
      action: 'Skip Fifteen Seconds Ahead',
      withAnalytics: true
    });
  },

  trackFastForward(sound) {
    let story = get(sound, 'metadata.contentModel');
    this._sendListenAction(story, 'forward_15');

    this._trackPlayerEvent({
      action: 'Skip Fifteen Seconds Ahead',
      withAnalytics: true
    });
  },


  /* Tracking helpers ---------------------------------------------------------
    --------------------------------------------------------------------------*/

  _sendListenAction(storyOrStream, type) {
    let data = {
      current_audio_position: this.get('position')
    };
    storyOrStream.forListenAction(data).then(d => {
      this.get('dataPipeline').reportListenAction(type, d);
    });
  },

  _trackCodecFailure({connectionName, error, url}, sound) {
    this._trackPlayerEvent({
      action: `Codec Failure | ${connectionName}`,
      label: `reason: ${error} | bad url: ${url} | ${sound ? `good url: ${get(sound, 'url')}` : 'no successful url'}`
    });
  },

  _trackPlayerEvent(options) {
    let metrics        = get(this, 'metrics');
    let {action, label, withRegion, region, withAnalytics} = options;
    let analyticsCode  = '';
    let story          = options.story || get(this, 'currentAudio');
    let category       = options.category || 'Persistent Player';

    // Ignore event if it's missing a region but should have one.
    // Assume it was fired from player internals and shouldn't be logged.
    if (withRegion && !region) { return; }
    region = withRegion ? region + ':' : '';
    if (withAnalytics) {
      analyticsCode = get(story, 'analyticsCode');
    }
    if (withRegion || withAnalytics) {
      label = `${region}${analyticsCode}`;
    }
    metrics.trackEvent('GoogleAnalytics', {category, action, label});
  },

  _trackPlayerEventForNpr(options) {
    let metrics = get(this, 'metrics');
    metrics.trackEvent('NprAnalytics', options);
  },

  _formatContext(context) {
    if (context === 'Continuous Play') {
      return context;
    } else if (context === 'nav') {
      return 'Navigation';
    } else if (!!context){
      return upperCamelize(context);
    }
  }
});
