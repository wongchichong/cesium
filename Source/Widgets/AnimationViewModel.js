/*global define*/
define(['./Command',
        './ButtonViewModel',
        '../Core/DeveloperError',
        '../Core/binarySearch',
        '../Core/ClockStep',
        '../Core/ClockRange',
        '../Core/Color',
        '../Core/JulianDate',
        '../Core/defaultValue',
        '../ThirdParty/sprintf',
        '../ThirdParty/knockout-2.2.1'
        ], function(
         Command,
         ButtonViewModel,
         DeveloperError,
         binarySearch,
         ClockStep,
         ClockRange,
         Color,
         JulianDate,
         defaultValue,
         sprintf,
         ko) {
    "use strict";

    var _monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var _maxShuttleAngle = 105;

    var AnimationViewModel = function(clockViewModel) {
        this.clockViewModel = clockViewModel;

        var that = this;

        this._canAnimate = ko.computed(function() {
            var clockRange = clockViewModel.clockRange();

            if (clockRange === ClockRange.UNBOUNDED) {
                return true;
            }

            var multiplier = clockViewModel.multiplier();
            var currentTime = clockViewModel.currentTime();
            var startTime = clockViewModel.startTime();

            if (clockRange === ClockRange.LOOP_STOP) {
                return currentTime.greaterThan(startTime) || (currentTime.equals(startTime) && multiplier > 0);
            }

            var stopTime = clockViewModel.stopTime();
            return (currentTime.greaterThan(startTime) && currentTime.lessThan(stopTime)) ||
                   (currentTime.equals(startTime) && multiplier > 0) ||
                   (currentTime.equals(stopTime) && multiplier < 0);
        });

        var shouldAnimate = this.shouldAnimate = ko.observable(false);

        this._isSystemTimeAvailable = ko.computed(function() {
            var clockRange = clockViewModel.clockRange();
            if (clockRange === ClockRange.UNBOUNDED) {
                return true;
            }

            var systemTime = clockViewModel.systemTime();
            var startTime = clockViewModel.startTime();
            var stopTime = clockViewModel.stopTime();
            return systemTime.greaterThanOrEquals(startTime) && systemTime.lessThanOrEquals(stopTime);
        });

        var shuttleRingTicks = ko.observable([//
        0.000001, 0.000002, 0.000005, 0.00001, 0.00002, 0.00005, 0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005,//
        0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 15.0, 30.0, 60.0, 120.0, 300.0, 600.0, 900.0,//
        1800.0, 3600.0, 7200.0, 14400.0, 21600.0, 43200.0, 86400.0, 172800.0, 345600.0, 604800.0]);

        this.shuttleRingTicks = ko.computed({
            read : shuttleRingTicks,
            write : function(value) {
                value = value.slice(0);
                value.sort(function(a, b) {
                    return a - b;
                });
                shuttleRingTicks(value);
            }
        });

        this.timeLabel = ko.computed(function() {
            return that.makeTimeLabel(clockViewModel.currentTime());
        });

        this.dateLabel = ko.computed(function() {
            return that.makeDateLabel(clockViewModel.currentTime());
        });

        this.speedLabel = ko.computed(function() {
            if (clockViewModel.clockStep() === ClockStep.SYSTEM_CLOCK_TIME) {
                return 'Today';
            }
            return clockViewModel.multiplier() + 'x';
        });

        var srd = ko.observable(false);
        this.shuttleRingDragging = ko.computed({
            read : function() {
                return srd();
            },
            write : function(value) {
                srd(value);
                if (!value) {
                    shouldAnimate(shouldAnimate() && that._canAnimate());
                }
            }
        });

        var isAnimatingObs = ko.computed(function() {
            return shouldAnimate() && (that._canAnimate() || that.shuttleRingDragging());
        });

        this.isAnimatingObs = isAnimatingObs;

        var pauseSelected = ko.computed({
            read : function() {
                return !isAnimatingObs();
            },
            write : function(value) {
                if (value && isAnimatingObs()) {
                    that._pause();
                } else if (!value && !isAnimatingObs()) {
                    that._unpause();
                }
            }
        });

        this.pauseViewModel = new ButtonViewModel({
            selected : pauseSelected,
            toolTip : ko.observable('Pause'),
            command : new Command(function() {
                pauseSelected(!pauseSelected());
            })
        });

        var playReverseSelected = ko.computed(function() {
            return isAnimatingObs() && (clockViewModel.multiplier() < 0);
        });

        this.playReverseViewModel = new ButtonViewModel({
            selected : playReverseSelected,
            toolTip : ko.observable('Play Reverse'),
            command : new Command(function() {
                if (!playReverseSelected()) {
                    that._cancelRealtime();
                    var multiplier = clockViewModel.multiplier();
                    if (multiplier > 0) {
                        clockViewModel.multiplier(-multiplier);
                    }
                    that._unpause();
                }
            })
        });

        var playSelected = ko.computed(function() {
            return isAnimatingObs() && clockViewModel.multiplier() > 0 && clockViewModel.clockStep() !== ClockStep.SYSTEM_CLOCK_TIME;
        });

        this.playViewModel = new ButtonViewModel({
            selected : playSelected,
            toolTip : ko.observable('Play Forward'),
            command : new Command(function() {
                if (!playSelected()) {
                    that._cancelRealtime();
                    var multiplier = clockViewModel.multiplier();
                    if (multiplier < 0) {
                        clockViewModel.multiplier(-multiplier);
                    }
                    that._unpause();
                }
            })
        });

        var playRealtimeSelected = ko.computed(function() {
            return clockViewModel.clockStep() === ClockStep.SYSTEM_CLOCK_TIME;
        });

        var playRealtimeCanExecute = ko.computed(function() {
            return that._isSystemTimeAvailable();
        });

        this.playRealtimeViewModel = new ButtonViewModel({
            selected : playRealtimeSelected,
            toolTip : ko.computed(function() {
                if (that._isSystemTimeAvailable()) {
                    return 'Today (real-time)';
                }
                return 'Current time not in range';
            }),
            command : new Command(function() {
                if (!playRealtimeSelected()) {
                    if (that._isSystemTimeAvailable()) {
                        clockViewModel.clockStep(ClockStep.SYSTEM_CLOCK_TIME);
                        clockViewModel.multiplier(1.0);
                        clockViewModel.currentTime(that.clockViewModel.clock.tick(0));
                        that.shouldAnimate(true);
                    }
                }
            }, playRealtimeCanExecute)
        });

        this.shuttleRingAngle = ko.computed({
            read : function() {
                var speed = clockViewModel.multiplier();
                var angle = Math.log(Math.abs(speed)) / 0.15 + 15;
                angle = Math.max(Math.min(angle, _maxShuttleAngle), 0);
                if (speed < 0) {
                    angle *= -1.0;
                }
                return angle;
            },
            write : function(angle) {
                if (Math.abs(angle) < 5) {
                    return 0;
                }

                angle = Math.max(Math.min(angle, _maxShuttleAngle), -_maxShuttleAngle);
                var speed = Math.exp(((Math.abs(angle) - 15.0) * 0.15));
                if (speed > 10.0) {
                    var scale = Math.pow(10, Math.floor((Math.log(speed) / Math.LN10) + 0.0001) - 1.0);
                    speed = Math.round(Math.round(speed / scale) * scale);
                } else if (speed > 0.8) {
                    speed = Math.round(speed);
                } else {
                    speed = this._getTypicalSpeed(speed);
                }
                if (angle < 0) {
                    speed *= -1.0;
                }

                if (speed !== 0) {
                    clockViewModel.multiplier(speed);
                    clockViewModel.clockStep(ClockStep.SYSTEM_CLOCK_MULTIPLIER);
                }
            },
            owner : this
        });

        this.moreReverse = {
            canExecute : true,
            execute : function() {
                that._cancelRealtime();
                var clockViewModel = that.clockViewModel;
                var multiplier = clockViewModel.multiplier();

                if (multiplier < 0) {
                    that._faster();
                } else {
                    that._slower();
                    if (multiplier < 0.0008) {
                        clockViewModel.multiplier(-0.001);
                    }
                }
            }
        };

        this.moreForward = {
            canExecute : true,
            execute : function() {
                that._cancelRealtime();
                var clockViewModel = that.clockViewModel;
                var multiplier = clockViewModel.multiplier();

                if (multiplier > 0) {
                    that._faster();
                } else {
                    that._slower();
                    if (multiplier > -0.0008) {
                        clockViewModel.multiplier(0.001);
                    }
                }
            }
        };
    };

    AnimationViewModel.prototype.update = function() {
        if (this.isAnimatingObs()) {
            this.clockViewModel.clock.tick();
        }
        this.clockViewModel.update();
    };

    /**
     * Override this function to change the format of the date label on the widget.
     * The returned string will be displayed as the middle line of text on the widget.
     *
     * @function
     * @memberof AnimationViewModel
     * @returns {String} The human-readable version of the current date.
     */
    AnimationViewModel.prototype.makeDateLabel = function(date) {
        var gregorianDate = date.toGregorianDate();
        return _monthNames[gregorianDate.month - 1] + ' ' + gregorianDate.day + ' ' + gregorianDate.year;
    };

    /**
     * Override this function to change the format of the time label on the widget.
     * The returned string will be displayed as the bottom line of text on the widget.
     *
     * @function
     * @memberof AnimationViewModel.prototype
     * @returns {String} The human-readable version of the current time.
     */
    AnimationViewModel.prototype.makeTimeLabel = function(date) {
        var gregorianDate = date.toGregorianDate();
        var millisecond = gregorianDate.millisecond;
        if (Math.abs(this.clockViewModel.multiplier()) < 1) {
            return sprintf("%02d:%02d:%02d.%03d", gregorianDate.hour, gregorianDate.minute, gregorianDate.second, millisecond);
        }
        return sprintf("%02d:%02d:%02d UTC", gregorianDate.hour, gregorianDate.minute, gregorianDate.second);
    };

    AnimationViewModel.prototype._cancelRealtime = function() {
        var clockViewModel = this.clockViewModel;
        if (clockViewModel.clockStep() === ClockStep.SYSTEM_CLOCK_TIME) {
            clockViewModel.clockStep(ClockStep.SYSTEM_CLOCK_MULTIPLIER);
            clockViewModel.multiplier(1);
        }
    };

    AnimationViewModel.prototype._pause = function() {
        this._cancelRealtime();
        this.shouldAnimate(false);
    };

    AnimationViewModel.prototype._unpause = function() {
        this._cancelRealtime();
        this.clockViewModel.currentTime(this.clockViewModel.clock.tick(0));
        this.shouldAnimate(true);
    };

    AnimationViewModel.prototype._getTypicalSpeed = function(speed) {
        var typicalMultipliers = this.shuttleRingTicks();
        var index = binarySearch(typicalMultipliers, Math.abs(speed), function(left, right) {
            return left - right;
        });

        if (index < 0) {
            index = ~index;
        }
        index--;

        if (index < 0) {
            index = 0;
        }
        return typicalMultipliers[index];
    };

    AnimationViewModel.prototype._slower = function() {
        var typicalMultipliers = this.shuttleRingTicks();

        var clockViewModel = this.clockViewModel;
        var multiplier = clockViewModel.multiplier();
        multiplier = multiplier > 0 ? multiplier : -multiplier;

        this._cancelRealtime();
        var index = binarySearch(typicalMultipliers, multiplier, function(left, right) {
            return left - right;
        });

        if (index < 0) {
            index = ~index;
        }
        index--;

        if (index >= 0) {
            if (clockViewModel.multiplier() >= 0) {
                clockViewModel.multiplier(typicalMultipliers[index]);
            } else {
                clockViewModel.multiplier(-typicalMultipliers[index]);
            }
        }
    };

    AnimationViewModel.prototype._faster = function() {
        var typicalMultipliers = this.shuttleRingTicks();
        var clockViewModel = this.clockViewModel;
        var multiplier = clockViewModel.multiplier();
        multiplier = multiplier > 0 ? multiplier : -multiplier;

        this._cancelRealtime();
        var index = binarySearch(typicalMultipliers, multiplier, function(left, right) {
            return left - right;
        });

        if (index < 0) {
            index = ~index;
        } else {
            index++;
        }

        if (index >= 0) {
            if (clockViewModel.multiplier() >= 0) {
                clockViewModel.multiplier(typicalMultipliers[index]);
            } else {
                clockViewModel.multiplier(-typicalMultipliers[index]);
            }
        }
    };

    return AnimationViewModel;
});
